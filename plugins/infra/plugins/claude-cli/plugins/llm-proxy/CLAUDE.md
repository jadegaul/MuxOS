# claude-cli/llm-proxy

The local translator proxy: Claude Code speaks only the Anthropic messages
API; a user's OpenAI-compatible model server (Ninfer, LM Studio, Ollama)
speaks only `chat/completions`. An **`openai` endpoint account** is addressed
at this proxy instead of the endpoint itself — every request Claude Code
makes under that account round-trips through it, translated back and forth.
An **`anthropic` endpoint** needs no translation and is addressed at itself
directly (no proxy traffic).

- **The address contract lives in `accounts/core`**
  (`internal/llm-proxy-address.ts`): `LLM_PROXY_PORT` (127.0.0.1 only) and
  `llmProxyUrl(accountId)` → `http://127.0.0.1:<port>/p/<accountId>` — the
  account's root, NOT its `/v1`: Claude Code appends its own `/v1/…` paths to
  the base, so a trailing `/v1` would send every call to `/v1/v1/…` (a 404
  Claude Code reads as "the model does not exist").
  accounts owns it — the endpoint credential
  (`claudeAccountCredential`) is what names the proxy path, and accounts
  must not import this plugin (that edge would be a cycle through
  `sdk` → accounts). This plugin imports accounts for the address, the
  account rows and the endpoint token; nothing else may (R6).
- **The translation is pure JSON** (`shared/translate.ts`, tested in
  `shared/translate.test.ts`): `translateRequest` (Anthropic → OpenAI:
  system/text/image base64+URL/tool_use→tool_calls/tool_result→role tool;
  extended thinking dropped — a local server has no budget for it; an
  unknown block type throws loudly, naming it), `mapResponse` (non-stream)
  and `StreamMapper` (SSE: `message_start` with zero usage, content blocks,
  `input_json_delta` per tool_call fragment, `message_delta` carrying the
  stream-end usage with `input_tokens` split out of `prompt_tokens` minus
  `cached_tokens`, `message_stop`). The model name arrives already resolved
  to the endpoint's own (`modelFlagForEndpoint` at the launch) — the
  translation never names a model.
- **`bin/proxy.ts`** — one process, `Bun.serve` on 127.0.0.1:
  `POST /p/:id/v1/messages` (the account must be an `openai` endpoint: the
  token from the secrets store rides as `Authorization: Bearer` — or no
  auth header at all when the endpoint has none; an unknown id is a 404, a
  non-endpoint a 400, both loud), `GET /p/:id/v1/models` (a passthrough to
  the endpoint's own list, best effort). An upstream failure is worded in
  the Anthropic error shape so Claude Code reads it as its own error — and a
  context-length refusal (a 400 whose words or `context_length_exceeded`
  code name the window) as the canonical `invalid_request_error` “prompt is
  too long: …” (`shared/shapeUpstreamError`): only in that shape does
  Claude Code's built-in prompt-too-long rescue engage (drop the oldest
  messages and retry; compact after a refused turn) — a generic `api_error`
  left a conversation past its server's window unable even to `/compact`.
  The
  accounts file is read PER REQUEST (a switch or a removed account changes
  the next request, no restart); the credential env variables are deleted
  at boot (the proxy must not run a session on the machine's own login).
  Writes its pid file after the bind, removes it on SIGTERM/SIGINT/exit.
- **`machine/` — the daemon** (`defineDaemon "claude-cli.llm-proxy"`,
  `where: "host-singleton"`, started on demand, never auto-restarted): the
  proxy serves every worktree's openai endpoint accounts — one process on
  the machine, owned by whichever worktree's backend reconciles first.
  `reconcileProxy` (on boot, and on every accounts-file change — the
  accounts watcher sees every worktree's write): start it iff ANY openai
  endpoint row exists (a `test-…` row too — a test is what proves the
  endpoint works before it is saved); stop it (SIGTERM via the pid file)
  when none does. A non-singleton worktree never starts it: its test waits
  (bounded, on the pid dir's watch) on the singleton its own test row woke
  elsewhere. The routes live here too (`implementMachine`):
  `POST /api/claude-accounts/test` — mint a `test-<nonce>` account
  (`changeClaudeAccounts`'s change mutex), save its token, `ensureProxyUp`
  (openai only), `readClaudeInitialize` (15 s) plus one `runClaudeTurn`
  (60 s, the model its map serves `sonnet` as — or the first mapped name,
  or the CLI default), best-effort `GET /models` (5 s) — then always
  remove the row and its secret in `finally`; the endpoint's own refusal
  words surface as a 502. `POST /api/claude-accounts/add-endpoint` runs
  the same test and stores the account only when it passes.
  `POST /api/claude-accounts/update-endpoint` edits an existing endpoint
  account in place (the UI's edit form — no destroy/recreate): the whole
  settings plus the name; the token, when given, replaces the stored one,
  and an empty body field keeps it. A change to the CONNECTION — API shape,
  base URL, model map, effective token (`connectionIdentityChanged`, pure,
  tested) — runs the same live test first, so a broken edit cannot brick
  the account; a name or context-window nudge persists directly (no
  60-second turn the user did not ask for).

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./muxos build` -->

## Plugin reference

- Description: The local LLM translator proxy, desktop half: one bun process per machine (bin/proxy.ts, the claude-cli.llm-proxy daemon, host-singleton, started detached and followed by its pid file) answering Claude Code's Anthropic messages calls at http://127.0.0.1:8800/p/<account> (Claude Code appends its own /v1/… paths — the base must not carry /v1) — an `openai` endpoint account's requests translated to its chat/completions (shared/translate, stream included), an `anthropic` endpoint's passed through at itself, the account's settings read per request from the machine-wide accounts file and its bearer token from the secrets store. The host singleton reconciles it against that file at boot and on every rewrite of it (main's watcher sees every worktree's write): it runs while any endpoint account speaks openai (a test's temporary row counts) and is stopped when none does; the other backends never start it — their endpoint test waits, bounded, for the singleton the test's own write woke. The endpoints an account is tested and added through (accounts core's declarations, implemented here because the test runs a real Claude Code turn — the SDK session, the proxy): POST /api/claude-accounts/test (one initialize and one turn on a temporary `test-…` row, deleted with its token after) and POST /api/claude-accounts/add-endpoint (the same test first — a broken endpoint is never stored).
- Machine:
  - Uses:
    - `infra/claude-cli/accounts.changeClaudeAccounts`
    - `infra/claude-cli/accounts.readClaudeAccounts`
    - `infra/claude-cli/accounts.watchClaudeAccounts`
    - `infra/endpoints.implementMachine`
  - Register: `defineDaemon('claude-cli.llm-proxy')`
- Exemptions:
  - Exempts itself from: `no-raw-sse` — `bin/proxy.ts` (sanctioned)
- Shared:
  - Exports (types):
    - `AnthropicRequest`
    - `OpenAIMessage`
    - `OpenAIRequest`
    - `OpenAIToolCall`
    - `UpstreamErrorShape`
  - Exports (values):
    - `finishReasonToStopReason`
    - `mapResponse`
    - `shapeUpstreamError`
    - `StreamMapper`
    - `translateRequest`
    - `usageOf`

<!-- AUTOGENERATED:END -->
