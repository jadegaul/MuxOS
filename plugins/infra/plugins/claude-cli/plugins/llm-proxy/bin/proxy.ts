#!/usr/bin/env bun
// First: the data root is declared before any import below can read a path.
import "./declare-data-root";
import { provideHostServicesUnbooted } from "@plugins/framework/plugins/server-core/core";
import {
  ACCOUNTS_FILE_NAME,
  CLAUDE_CREDENTIAL_ENVS,
  LLM_PROXY_PORT,
  parseAccountsFile,
  type ClaudeAccount,
  type ClaudeAccounts,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/core";
import { claudeAccountsDir } from "@plugins/infra/plugins/claude-cli/plugins/accounts/data-dirs";
import { claudeEndpointToken } from "@plugins/infra/plugins/claude-cli/plugins/accounts/server";
import { SecretStore } from "@plugins/infra/plugins/secrets/server";
import { centralSecretStore } from "@plugins/infra/plugins/secrets/cli";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "@plugins/packages/plugins/timed-fs/core";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { mapResponse, StreamMapper, translateRequest } from "../shared";

// The local translator proxy: ONE process per machine (the host singleton's
// daemon starts it detached), answering on 127.0.0.1 — the address Claude Code
// takes for every OpenAI-compatible endpoint account (`llmProxyUrl`, in
// accounts/core).
//
//   POST /p/<id>/v1/messages  — an Anthropic messages call for account <id>:
//                               its `openai` endpoint translated to
//                               chat/completions (shared/translate), its
//                               `anthropic` endpoint reached at itself.
//   GET  /p/<id>/v1/models    — the endpoint's own model list, passed through.
//
// Per request it reads the account's settings from the machine-wide accounts
// file and its bearer token from the secrets store (this process boots no
// graph: it names the one host service it reads itself, the central secrets
// store — an added account's token). An unknown id answers 404, a non-endpoint
// id 400: the proxy serves endpoints only, loudly. The pid file exists exactly
// while the process holds its port: written once the bind succeeds, removed as
// it exits — that file is its liveness (the daemon follows it).
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { "pid-file": { type: "string" } },
  strict: true,
});
const rawPidFile = values["pid-file"];
if (!rawPidFile) throw new Error("usage: proxy.ts --pid-file <path>");
const pidFile: string = rawPidFile;

// This process's environment is a relay's: it signs in as nothing, so every
// credential variable it was started with is stripped before it fetches —
// an upstream is reached with the endpoint's own token alone, never a leaked
// Claude login.
for (const name of CLAUDE_CREDENTIAL_ENVS) delete process.env[name];

provideHostServicesUnbooted([SecretStore.provide(centralSecretStore)]);

/**
 * The machine-wide accounts file, read PER REQUEST (a switch or a removed
 * account changes the next request, no restart): this process is the host and
 * reads it itself — the file's parse is pure (`core`), a file that does not
 * exist means none added yet, a corrupt one throws.
 */
async function endpointAccount(id: string): Promise<ClaudeAccount | undefined> {
  let accounts: ClaudeAccounts;
  try {
    const text = await readFile(
      claudeAccountsDir.file(ACCOUNTS_FILE_NAME),
      "utf8",
    );
    accounts = parseAccountsFile(JSON.parse(text)).state;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return undefined; // the file does not exist: no account has been added
  }
  return accounts.accounts.find((a) => a.id === id);
}

/** The endpoint an account points at, or a loud refusal naming the id. */
async function endpointOf(
  id: string,
): Promise<
  | { ok: true; api: "openai" | "anthropic"; baseUrl: string }
  | { ok: false; status: number; message: string }
> {
  const account = await endpointAccount(id);
  if (!account)
    return {
      ok: false,
      status: 404,
      message: `No Claude account "${id}" — the LLM proxy serves endpoint accounts only`,
    };
  if (account.kind !== "endpoint")
    return {
      ok: false,
      status: 400,
      message: `Claude account "${id}" is not a local endpoint — the LLM proxy serves endpoints only`,
    };
  const base = account.endpoint.baseUrl.replace(/\/+$/, "");
  return { ok: true, api: account.endpoint.api, baseUrl: base };
}

/** The bearer headers an `openai` endpoint expects: its token, or none. */
async function openaiHeaders(id: string): Promise<Record<string, string>> {
  const token = await claudeEndpointToken(id);
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

/** An upstream's error body, read and worded in the Anthropic shape. */
async function upstreamError(res: Response, what: string): Promise<Response> {
  let detail = "";
  let text = "";
  try {
    text = await res.text();
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const error = json.error as Record<string, unknown> | undefined;
      detail =
        typeof error?.message === "string"
          ? error.message
          : typeof json.message === "string"
            ? json.message
            : text.slice(0, 500);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // A body the endpoint did not answer in JSON: its own words, verbatim.
      detail = text.slice(0, 500);
    }
  } catch (err) {
    // A read that died mid-stream is a real failure — it propagates.
    throw err;
  }
  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: `${what} refused (${res.status})${detail === "" ? "" : `: ${detail}`}`,
      },
    },
    {
      status:
        res.status === 401 || res.status === 403
          ? 401
          : res.status >= 500
            ? 502
            : res.status,
    },
  );
}

const encoder = new TextEncoder();

/** One translated stream: the upstream's SSE frames → the Anthropic events. */
function translatedStream(upstream: Response, requestModel: string): Response {
  const mapper = new StreamMapper(requestModel);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = upstream.body!.getReader();
        const decode = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decode.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "" || data === "[DONE]") continue;
              let chunk: Record<string, unknown>;
              try {
                chunk = JSON.parse(data);
              } catch (err) {
                if (!(err instanceof SyntaxError)) throw err;
                continue; // a comment or a partial the framing kept — never a chunk
              }
              for (const event of mapper.push(chunk))
                controller.enqueue(encoder.encode(event));
            }
          }
        }
        for (const event of mapper.finish())
          controller.enqueue(encoder.encode(event));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: LLM_PROXY_PORT,
  // The upstream's time-to-first-byte IS the endpoint's prefill: a 27B model
  // chewing a full agent context (30k+ tokens) can take a minute or more before
  // its first byte, and the default 10 s request timeout would cut Claude Code
  // off mid-prefill — it then retries, and every retry re-prefills the whole
  // prompt on a GPU that may be busy with the previous attempt's prefill
  // (observed 2026-11-21, Ninfer/Qwen3.8-27b: nine straight attempts died at
  // ~12 s; the one that landed took 44 s). Bun caps idleTimeout at 255 s —
  // the most it allows, which covers realistic prefills many times over.
  idleTimeout: 255,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const match = /^\/p\/([^/]+)\/v1\/(messages|models)$/.exec(pathname);
    if (!match || !match[1] || !match[2])
      return Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request",
            message: `The LLM proxy answers /p/<account>/v1/{messages,models} — asked for ${req.method} ${req.url}`,
          },
        },
        { status: 404 },
      );
    const id = match[1];
    const which = match[2];
    if (which === "messages" && req.method !== "POST")
      return Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request",
            message: `messages takes POST, got ${req.method}`,
          },
        },
        { status: 405 },
      );
    if (which === "models" && req.method !== "GET")
      return Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request",
            message: `models takes GET, got ${req.method}`,
          },
        },
        { status: 405 },
      );

    const endpoint = await endpointOf(id);
    if (!endpoint.ok)
      return Response.json(
        {
          type: "error",
          error: { type: "invalid_request", message: endpoint.message },
        },
        { status: endpoint.status },
      );

    if (which === "models") {
      // The endpoint's own list, passed through (both API shapes answer
      // <base>/models with { data: [{ id }] }).
      const upstream = await fetch(`${endpoint.baseUrl}/models`, {
        headers: endpoint.api === "openai" ? await openaiHeaders(id) : {},
        signal: req.signal,
      }).catch((err) => upstreamNetworkError(err, endpoint.baseUrl));
      if (upstream instanceof Response && !upstream.ok)
        return upstreamError(upstream, `the endpoint ${endpoint.baseUrl}`);
      if (!(upstream instanceof Response)) return upstream;
      return new Response(await upstream.text(), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      return Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request",
            message: "The request body is not JSON",
          },
        },
        { status: 400 },
      );
    }
    const model = typeof body.model === "string" ? body.model : "";

    if (endpoint.api === "anthropic") {
      // Reached at itself: the call goes through unchanged, its auth with it.
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const auth = req.headers.get("authorization");
      const apiKey = req.headers.get("x-api-key");
      if (auth) headers.authorization = auth;
      if (apiKey) headers["x-api-key"] = apiKey;
      const upstream = await fetch(`${endpoint.baseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      }).catch((err) => upstreamNetworkError(err, endpoint.baseUrl));
      if (upstream instanceof Response && !upstream.ok)
        return upstreamError(upstream, `the endpoint ${endpoint.baseUrl}`);
      if (!(upstream instanceof Response)) return upstream;
      const text = await upstream.text();
      return new Response(text, {
        status: 200,
        headers: {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        },
      });
    }

    // `openai`: the translation, both directions.
    let request;
    try {
      request = translateRequest(
        body as Parameters<typeof translateRequest>[0],
      );
    } catch (err) {
      return Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        { status: 400 },
      );
    }
    const upstream = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await openaiHeaders(id)),
      },
      body: JSON.stringify(request),
      signal: req.signal,
    }).catch((err) => upstreamNetworkError(err, endpoint.baseUrl));
    if (!(upstream instanceof Response)) return upstream;
    if (!upstream.ok)
      return upstreamError(upstream, `the endpoint ${endpoint.baseUrl}`);

    if (request.stream === true) return translatedStream(upstream, model);
    const json = (await upstream.json()) as Record<string, unknown>;
    return Response.json(mapResponse(json, model));
  },
});

function upstreamNetworkError(err: unknown, baseUrl: string): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: `Could not reach the endpoint ${baseUrl}: ${message}`,
      },
    },
    { status: 502 },
  );
}

// The bind succeeded: the pid file is liveness from now until the exit.
mkdirSync(dirname(pidFile), { recursive: true });
writeFileSync(pidFile, String(process.pid));
console.log(
  `[llm-proxy] listening on http://127.0.0.1:${String(server.port)} (pid ${String(process.pid)})`,
);

function exitNow(signal?: string): void {
  try {
    rmSync(pidFile, { force: true });
    // eslint-disable-next-line promise-safety/no-bare-catch -- the process exits either way; a pid file left behind names a dead pid, which the daemon reads as stopped
  } catch (err) {
    console.error(
      `[llm-proxy] could not remove its pid file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log(`[llm-proxy] exiting (${signal ?? "exit"})`);
  process.exit(0);
}
process.on("SIGTERM", () => exitNow("SIGTERM"));
process.on("SIGINT", () => exitNow("SIGINT"));
process.on("exit", () => {
  try {
    rmSync(pidFile, { force: true });
    // eslint-disable-next-line promise-safety/no-bare-catch -- in an exit handler nothing can be thrown or retried: the pid is leaving the machine anyway, and a leftover file names a dead pid (the daemon reads it as stopped)
  } catch {
    // Already gone (a signal handler took it): nothing to do.
  }
});
