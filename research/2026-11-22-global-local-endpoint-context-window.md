# Local endpoint context window: adjustable per account, and the stuck-conversation rescue

**Date:** 2026-11-22 · **Status:** proposed · **Category:** global (infra/claude-cli + conversations UI)

## Context

A local model endpoint (Ninfer, `qwen3.8-27b`) runs as an equin endpoint account. Its conversation
`conv-1795307244-xjjj8d` (worktree `local-ai-endpoint`) is **stuck**:

- 09:29 turn dies: `API Error: 400 the endpoint http://100.99.219.116:8080/v1 refused (400): prepared prompt exceeds Engine max_context 262144` — Ninfer's real window is **262,144 tokens**.
- 10:30 the user typed `/compact` from the app: it failed with the same 400 — the summary request carries the full history, which already exceeds 256K, so compaction itself cannot be served.

Two independent defects, both confirmed in code:

1. **The client assumes a 1M window.** The bundled Claude Code resolves a model's believed
   context window in `LC()` in the CLI bundle: unknown (non-Claude) models fall back to
   `uz = 1e6` (`hkt = 200000` is the known-model default). Threshold-triggered auto-compact
   therefore sits at ~950K — far past Ninfer's 262K hard limit — and never fires before the
   server refuses. The CLI's own "unknown model" notice tells the user to
   **`set CLAUDE_CODE_MAX_CONTEXT_TOKENS to its real window`** — that env var is the sanctioned
   knob (`LC()` honors it for exactly this case).
2. **The proxy mis-shapes the refusal.** `upstreamError` (`llm-proxy/bin/proxy.ts:110`) returns
   `error.type: "api_error"` for every upstream status, including context-length 400s. Claude
   Code classifies prompt-too-long on the Anthropic shape (`prompt is too long…`,
   `invalid_request_error`), and only then do its reactive rescues engage: the
   `compact_after_prompt_too_long` turn recovery, and compaction's drop-oldest-and-retry loop
   (`tengu_compact_ptl_retry`). Generic `api_error` → neither runs → a conversation past the
   hard limit can never compact itself.

**Outcome:** (a) the user can adjust a local endpoint's context length per account; (b) the
proxy speaks proper PTL errors so Claude Code's built-in rescues work as a backstop; (c)
`conv-1795307244-xjjj8d` is compacted and usable again.

## Design

### 1. `contextWindow` on endpoint accounts (the feature)

`plugins/infra/plugins/claude-cli/plugins/accounts/core/internal/accounts.ts`:

- `ClaudeEndpointSettingsSchema` (line ~120): add
  `contextWindow: z.number().int().positive().optional()` — "the endpoint model's real context
  window in tokens; when set, Claude Code is told via `CLAUDE_CODE_MAX_CONTEXT_TOKENS` so
  auto-compact fires before the server refuses (it believes 1M for models it does not know —
  observed: Ninfer at 262144 died uncompactable)". Applies to both `openai` and `anthropic`
  endpoint kinds (both are local servers with real windows).
- The endpoint arm of `ClaudeAccountCredential` (line 177): carry `contextWindow?: number`.
- `claudeEndpointEnv` (line 199): after the timeout ceilings,
  `if (credential.contextWindow !== undefined) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(credential.contextWindow);`
  — document the why (the CLI's unknown-model notice names this variable).
- `claudeAccountCredential` (`server/internal/tokens.ts:65-75`): pass the field through in the
  endpoint arm.
- **First `claudeEndpointEnv` tests** (none exist today): extend `core/internal/accounts.test.ts`
  — set → var present with the value; unset → absent; plus the existing behaviors (proxy base
  URL, `equin-local` placeholder, mapped small-fast model, the three timeout ceilings).
- `core/internal/accounts-file.test.ts`: parse round-trip of an endpoint row carrying
  `contextWindow`.

**Update route** (there is none today — the UI is add/remove/select only; editing a number must
not require destroy/recreate):

- Declare `updateClaudeEndpoint` in `accounts/core/internal/accounts.ts` beside the other
  endpoint declarations (lines 283–331): `POST /api/claude-accounts/update-endpoint`,
  body `{ id, name?, endpoint: ClaudeEndpointSettingsSchema, token? }`, response
  `ClaudeAccountSchema`, `needsMachine` like its siblings.
- Implement in `llm-proxy/machine/internal/routes.ts` next to `handleAddClaudeEndpoint`
  (registered in `llm-proxy/machine/index.ts`) — llm-proxy already imports
  `changeClaudeAccounts` / `saveClaudeAccountCredential` from accounts, so no new import edge
  (accounts must not import llm-proxy: cycle through `sdk`).
- Semantics: read the current row (must exist and be `kind: "endpoint"`). If the **connection
  identity** — `api`, `baseUrl`, token, `modelMap` — changed, run the same live test
  `add-endpoint` runs (a broken edit must not brick an account, especially the active one) and
  persist only on success; a `name`/`contextWindow`-only change persists directly via
  `changeClaudeAccounts` (+ `saveClaudeAccountCredential` when the token changes). The
  identity comparison is a small pure helper (`connectionIdentityChanged(prev, next)`) with its
  own unit test — no 60-second live turn when the user is merely adjusting a number.

**UI** — `plugins/conversations/plugins/runtime-sdk/web/components/claude-accounts.tsx` (all of
the accounts surface):

- Generalize `AddEndpointForm` (line 377) into `EndpointForm({ initial?, onSaved, onCancel })`:
  pre-seed `name`, `baseUrl`, `api`, `token`, `maps` from the existing row, and add one field —
  "Context window (tokens)", optional number, empty = leave as-is/auto. Existing validation
  (`badUrl`, `badMapping`) and the Test button carry over unchanged.
- Account row (line ~719, beside the remove `IconButton`): an edit `IconButton` that opens the
  pre-seeded form; submit → `fetchEndpoint(updateClaudeEndpoint, …)`. The add flow is the same
  component with `initial === undefined` → `addClaudeEndpoint`.

### 2. PTL error shape (proxy backstop)

- Extract a pure `shapeUpstreamError(status, detail, what) → { status, errorType, message }`
  into `llm-proxy/shared/translate.ts`:
  - `status === 400` and the detail matches a context-length pattern
    (`/max[_ ]?context|maximum context length|context length exceeded|exceeds[\s\S]{0,60}(context|token)|too many tokens/i`)
    → `{ 400, "invalid_request_error", "prompt is too long: <detail>" }` — the canonical
    Anthropic prefix Claude Code classifies.
  - otherwise today's mapping: `401/403 → 401`, `≥500 → 502`, else pass-through;
    `errorType: "api_error"`.
- `upstreamError` in `bin/proxy.ts` becomes a thin wrapper over it (covers both the `openai`
  translation path and the `anthropic` passthrough — an already-correct upstream message keeps
  its words, only normalized into the same shape).
- Tests in `shared/translate.test.ts`: Ninfer's verbatim message
  (`prepared prompt exceeds Engine max_context 262144`) → PTL shape; a generic 400 →
  `api_error`; 500 → 502; 401 → 401.

With both pieces in place: a normal turn auto-compacts at ~the configured window before Ninfer
refuses; if the window is unset (or wrong), the PTL shape lets Claude Code's own
drop-oldest-and-retry rescue a compaction that itself overflows.

### 3. The rescue (operational, after deploy)

1. `./equin build` (worktree, background) deploys the feature; the backend's boot reconciles
   the llm-proxy daemon onto the new code.
2. Set Ninfer's `contextWindow` to **262144** (its own error message revealed the value) via
   the new endpoint (loopback, owner principal). The user can change it anytime in the UI.
3. Kill the stuck conversation's idle agent process
   (`~/.equin/locks/sdk-agents/local-ai-endpoint/conv-1795307244-xjjj8d.pid`) — a running
   process keeps its start-time environment; the next spawn picks up
   `CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144`.
4. Post `/compact` as a user turn on `conv-1795307244-xjjj8d`
   (`POST /api/conversations/:id/turn`, text `/compact` — forwarded verbatim, runs as a command
   while the CLI is idle; precedent: turn-ledger confirms slash-command turns, self-compact
   types them the same way). The fresh process resumes the over-limit session; the compaction
   request still overflows 262144 → Ninfer 400 → proxy PTL shape → Claude Code's
   drop-oldest-and-retry fits it → summary lands → the transcript shrinks.
5. Verify: `agent.log` shows the compact success and a follow-up "ping" turn answers; the
   conversation's ctx reading (the `context-usage` chip) reads well under the window.

## Files

- `plugins/infra/plugins/claude-cli/plugins/accounts/core/internal/accounts.ts` — schema,
  credential arm, `claudeEndpointEnv`, `updateClaudeEndpoint` declaration
- `plugins/infra/plugins/claude-cli/plugins/accounts/server/internal/tokens.ts` — credential
  passthrough
- `plugins/infra/plugins/claude-cli/plugins/accounts/core/internal/accounts.test.ts` — env
  builder tests (new coverage)
- `plugins/infra/plugins/claude-cli/plugins/accounts/core/internal/accounts-file.test.ts` — parse
  round-trip
- `plugins/infra/plugins/claude-cli/plugins/llm-proxy/shared/translate.ts` (+
  `shared/translate.test.ts`) — `shapeUpstreamError`
- `plugins/infra/plugins/claude-cli/plugins/llm-proxy/bin/proxy.ts` — use it in `upstreamError`
- `plugins/infra/plugins/claude-cli/plugins/llm-proxy/machine/internal/routes.ts` (+
  `machine/index.ts`) — `handleUpdateClaudeEndpoint` + identity helper + test
- `plugins/conversations/plugins/runtime-sdk/web/components/claude-accounts.tsx` — edit form +
  row action
- Docs (hand-written sections): `accounts/CLAUDE.md`, `llm-proxy/CLAUDE.md`

No migrations (the accounts file is plain JSON), no gateway changes, no new top-level plugin.

## Verification

- `./equin test plugins/infra/plugins/claude-cli` — env builder, parse, error shape, identity
  helper.
- `./equin build` (background) — deploy; checks included.
- Browser (agent-browser, tailnet door): accounts panel shows the new field on the edit form;
  edit Ninfer to 262144; the ledger row and "Local model" badge unaffected.
- Rescue per §3: agent.log compact + ping turn; ctx chip below the window.
- Regression guard for the shape: a non-context 400 (e.g. a bad model name) still reads as a
  plain `api_error` with the endpoint's words — no false PTL classification (a false PTL would
  burn a compaction on every typo'd model name).
