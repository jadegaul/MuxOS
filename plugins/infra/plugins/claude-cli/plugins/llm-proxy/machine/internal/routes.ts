import { tmpdir } from "node:os";
import { HttpError } from "@plugins/infra/plugins/endpoints/core";
import { implementMachine } from "@plugins/infra/plugins/endpoints/machine";
import {
  addClaudeEndpoint,
  mintTestAccountId,
  testClaudeEndpoint,
  type ClaudeAccount,
  type ClaudeEndpointSettings,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/core";
import { changeClaudeAccounts } from "@plugins/infra/plugins/claude-cli/plugins/accounts/machine";
import {
  deleteClaudeAccountCredential,
  saveClaudeAccountCredential,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/server";
import {
  ClaudeInitializeTimeoutError,
  ClaudeTurnError,
  claudeSessionEnv,
  readClaudeInitialize,
  runClaudeTurn,
  type ClaudeTurnResult,
} from "@plugins/infra/plugins/claude-cli/plugins/sdk/server";
import { ensureProxyUp } from "./proxy-daemon";

// The endpoint's two routes, both implemented here (not in accounts/machine):
// each runs the endpoint through a REAL Claude Code turn before it is trusted
// — that needs the SDK session and the proxy, which are this plugin's. The
// test mints a temporary `test-…` account row (the accounts file is the one
// state the turn's environment reads, so the test runs on exactly what saving
// would run on), runs one initialize and one turn on it, and deletes it with
// its token; `add-endpoint` runs the same test first and stores the row only
// on a green one — a broken endpoint never reaches the list.

const INITIALIZE_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 5_000;

/** The model a test turn runs on: a mapped family, or the CLI's own default. */
function testModel(settings: ClaudeEndpointSettings): string | undefined {
  if (settings.modelMap === undefined) return undefined; // no map: the default Claude name, the server's refusal is the answer
  return (
    settings.modelMap.sonnet ?? Object.values(settings.modelMap)[0] ?? undefined
  );
}

/** The turn's words, success or error result alike — both are the answer. */
function replyOf(result: ClaudeTurnResult): string {
  if (result.subtype === "success") return result.result ?? "";
  const detail = (result.errors ?? []).join("; ").trim();
  return detail === ""
    ? `The endpoint answered an error (${result.subtype})`
    : detail;
}

/** The endpoint's own model list, best effort: absent or broken is not a failure. */
async function offeredModels(
  baseUrl: string,
  token: string | undefined,
): Promise<string[] | undefined> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    // eslint-disable-next-line promise-safety/no-bare-catch, promise-safety/no-absorbed-failure -- best effort by contract: every failure shape (refused, DNS, timed out) means "the endpoint offers no list", which the caller merges away — the turn that PROVED the endpoint already succeeded
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  let json: { data?: Array<{ id?: unknown }> };
  try {
    json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    // eslint-disable-next-line promise-safety/no-bare-catch, promise-safety/no-absorbed-failure -- same contract: a body that is not JSON is "no list", not a failure of the test
  } catch {
    return undefined;
  }
  const names = (json.data ?? [])
    .map((m) => (typeof m.id === "string" ? m.id : null))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names : undefined;
}

/**
 * One turn on the endpoint through the real session path: the temporary
 * account's environment (its base URL — the proxy's for `openai`), an
 * initialize, then the turn itself. Throws a `HttpError` 502 worded with the
 * endpoint's own words when it does not answer.
 */
async function runTestTurn(
  id: string,
  settings: ClaudeEndpointSettings,
  token: string | undefined,
): Promise<{ reply: string; models?: string[] }> {
  if (settings.api === "openai") await ensureProxyUp();
  const env = await claudeSessionEnv(id);
  let reply: string;
  try {
    await readClaudeInitialize({
      env,
      cwd: tmpdir(),
      timeoutMs: INITIALIZE_TIMEOUT_MS,
    });
    const model = testModel(settings);
    const turn = await runClaudeTurn({
      env,
      prompt: "Reply with exactly: ok",
      options: {
        cwd: tmpdir(),
        tools: [],
        ...(model !== undefined ? { model } : {}),
        persistSession: false,
      },
      timeoutMs: TURN_TIMEOUT_MS,
    });
    reply = replyOf(turn.result);
    // A turn that hit an API failure (a refused model, a 404, an auth error)
    // still ENDS with a result — that is not a pass. The endpoint is proven
    // only by a turn that succeeded with no API failure, so anything else is
    // the endpoint's own refusal, surfaced as a 502 (and never stored by
    // add-endpoint).
    if (turn.apiError !== null || turn.result.subtype !== "success")
      throw new HttpError(502, `The endpoint did not answer: ${reply}`);
  } catch (err) {
    if (err instanceof ClaudeTurnError)
      throw new HttpError(502, `The endpoint did not answer: ${err.message}`);
    if (err instanceof ClaudeInitializeTimeoutError)
      throw new HttpError(
        502,
        `Claude Code did not come up on the endpoint within ${String(Math.round(INITIALIZE_TIMEOUT_MS / 1000))} s — ${err.message}`,
      );
    throw err;
  }
  const models = await offeredModels(settings.baseUrl, token);
  return { reply, ...(models !== undefined ? { models } : {}) };
}

/** One test of `settings` as `token`, on a temporary row that is deleted after. */
async function testEndpoint(
  settings: ClaudeEndpointSettings,
  token: string | undefined,
): Promise<{ reply: string; models?: string[] }> {
  const id = mintTestAccountId();
  await changeClaudeAccounts((state) => ({
    ...state,
    accounts: [
      ...state.accounts,
      {
        id,
        name: "(endpoint test)",
        addedAt: Date.now(),
        kind: "endpoint",
        endpoint: settings,
      },
    ],
  }));
  if (token !== undefined) await saveClaudeAccountCredential(id, token);
  try {
    return await runTestTurn(id, settings, token);
  } finally {
    await changeClaudeAccounts((state) => ({
      ...state,
      accounts: state.accounts.filter((a) => a.id !== id),
    }));
    await deleteClaudeAccountCredential(id);
  }
}

export const handleTestClaudeEndpoint = implementMachine(
  testClaudeEndpoint,
  async ({ body }) => testEndpoint(body.endpoint, body.token || undefined),
);

/** Add an endpoint account: the same test first — a broken endpoint is never stored. */
export const handleAddClaudeEndpoint = implementMachine(
  addClaudeEndpoint,
  async ({ body }) => {
    const token = body.token || undefined;
    await testEndpoint(body.endpoint, token);
    const account: ClaudeAccount = {
      id: `acct-${crypto.randomUUID().slice(0, 8)}`,
      name: body.name,
      addedAt: Date.now(),
      kind: "endpoint",
      endpoint: body.endpoint,
    };
    if (token !== undefined)
      await saveClaudeAccountCredential(account.id, token);
    await changeClaudeAccounts((state) => ({
      ...state,
      accounts: [...state.accounts, account],
    }));
    return account;
  },
);
