# Local AI endpoints as Claude accounts — v2

**Date:** 2026-11-21 · **Status:** proposed (iteration of
[`2026-11-21-global-local-ai-endpoint-accounts.md`](./2026-11-21-global-local-ai-endpoint-accounts.md)) ·
**Supersedes** v1's §1 (token required) and adds the OpenAI-translation layer.

Everything in v1 stands except where noted below. v1 covered: the account
kind, the credential union, the env seam (`envFromCredential`), the Strategy-B
modelMap overlay (agent-process resolution), the test-connection boundary, and
the metered-free classification. Two things changed with the target hardware:

## What changed

### 1. Endpoints come in two API kinds — the OpenAI kind rides a built-in translator

The first real endpoint (Ninfer, `http://localhost:8080`, **OpenAI-compatible,
no auth**) does not speak the Anthropic Messages API, and Claude Code only
speaks Anthropic. The fix is not "tell the user to run LiteLLM" — it is a
small **equin-owned translation proxy**, so any OpenAI-compatible server
(Ninfer, Ollama, vLLM, most LM Studio configs) works as well as any
Anthropic-native one (LM Studio's `/v1/messages`, LiteLLM, adapters).

- `ClaudeEndpointSchema` (accounts/core) gains
  `api: z.enum(["openai", "anthropic"])` — default/open is `openai`.
  `baseUrl` (validated http/https), `token` (**now optional** — v1's
  required-token decision is reversed: Ninfer has no auth), `modelMap`.
- **`api: "anthropic"`** → `ANTHROPIC_BASE_URL` is the endpoint URL itself.
- **`api: "openai"`** → `ANTHROPIC_BASE_URL` is the **proxy URL**:
  `http://127.0.0.1:<PORT>/p/<accountId>` (the CLI appends `/v1/messages`;
  the path routes to that endpoint's upstream).
- New sub-plugin **`claude-cli/llm-proxy`** (machine + core, nested under
  claude-cli — no new top-level infra plugin):
  - **core**: `PROXY_PORT = 8800` (fixed, 127.0.0.1 only — no allocation
    logic; a bind collision fails loudly at proxy start and names the port;
    it sits clear of the gateway's 8700–8709), `proxyBaseUrl(accountId)`.
  - **machine**: a single bun HTTP process, path-routed
    (`POST /p/:id/v1/messages`, `GET /p/:id/v1/models` passthrough), reading
    endpoint config per-request from the accounts file + secrets (no reload
    on change). Lifecycle is **push, not polled**: started on boot if any
    `openai` endpoint exists, on `add-endpoint`, and restarted by its exit
    listener while any `openai` endpoint exists; stopped when none do
    (wedge-proof spawn, pid file + log under the claude-accounts data dir).
    Launch paths (`startAgentProcess`, one-shot `invokeClaude`) never gate on
    it: a dead proxy answers connection-refused and the existing loud failure
    path reports it.
  - **`translate.ts`** (pure, unit-tested): Anthropic body → OpenAI
    `chat/completions` body (system prompt → `system` message; `tool_result`
    user blocks → `tool` role; `tools` → OpenAI `tools`; `max_tokens`,
    `temperature` passed through; `thinking` dropped) and the streaming mapper:
    OpenAI `chat.completion.chunk` deltas → Anthropic SSE events
    (`message_start`, `content_block_start/delta/stop` for text and
    `tool_use`, `message_delta` with `stop_reason` + **`usage`**,
    `message_stop`). The usage mapping matters: the usage ledger reads the
    CLI's transcript JSONL, which the CLI writes from `message_delta`'s
    usage — correct usage in the stream ⇒ the ledger works untouched.
    `stream_options: { include_usage: true }` is requested upstream.
  - **auth forwarding**: `token` present ⇒ `Authorization: Bearer <token>`
    upstream; absent ⇒ no header (Ninfer).
  - Anthropic-kind endpoints **never** touch the proxy (direct dial) — the
    proxy exists only to speak OpenAI.

Consequences elsewhere:
- `claudeEndpointEnv(base, ep)`: `ANTHROPIC_BASE_URL` = `ep.baseUrl`
  (anthropic) or `proxyBaseUrl(ep.id)` (openai); `ANTHROPIC_AUTH_TOKEN` only
  when a token is set. `CLAUDE_CREDENTIAL_ENVS` += `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_AUTH_TOKEN` (v1) — with no token, the base URL alone still makes
  the chrome-needs-system-account guard read the session as non-system.
- `claudeAccountCredential`'s endpoint arm: `{ kind: "endpoint"; api; baseUrl;
  token: string | null; modelMap? }` — a missing secret is fine for endpoints
  (no-auth); the "secret gone → throw" check stays api-key-only.
- The test-connection turn (v1 §4) proves the whole path for the openai kind
  because it flows proxy → Ninfer: it is the smoke test for `translate.ts`
  against a real server.
- If the bundled CLI refuses to dial a custom base URL with **no** auth
  variable at all (possible startup guard), `claudeEndpointEnv` falls back to
  setting `ANTHROPIC_AUTH_TOKEN` to a placeholder (`equin-local`) for
  token-less endpoints — decided empirically against Ninfer in verification;
  the proxy ignores it.

### 2. The form offers the API kind

Add-endpoint dialog (v1 §web): name, base URL, **API kind select**
(OpenAI-compatible [default] / Anthropic), token (optional, placeholder
"leave empty if no auth"), collapsible modelMap rows (haiku/sonnet/opus/fable
→ local model name, `^claude-`-prefix rejection retained). For Ninfer the
modelMap values are its model names (readable from its `/v1/models`, which
the test surfaces).

## Verification (updated)

1. Probe Ninfer first: `GET http://localhost:8080/v1/models` (note the model
   names for the live modelMap).
2. Units: translate.ts body + SSE mapper (fixture OpenAI streams incl.
   tool calls and a final usage chunk); accounts core/machine (kind,
   optional token, strip list); modelFlagForEndpoint; launch-options id
   pass-through; usage-probe skip; proxy lifecycle (start/stop on endpoint
   set, bind-conflict loud failure).
3. Live (after `./equin build`): add `Ninfer` (openai, `http://localhost:8080`,
   no token, modelMap sonnet→<ninfer model>, opus→<same or better>) → Test
   green (turn returns Ninfer's words) → launch a conversation on it
   (transcript streams; tool calls round-trip through the translator) →
   one-shot title job via Ninfer (`claude_cli_calls` row; usage ledger rows
   carry Ninfer's model name at $0; no `cost-unpriced-model` /
   `ClaudeUsageReadFailed`) → switch back to the system account (mapped names
   never reach Anthropic) → add an Ollama-style endpoint row to prove
   multi-endpoint coexistence (path routing isolates them).
