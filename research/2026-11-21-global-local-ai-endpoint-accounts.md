# Local AI endpoints as Claude accounts

**Date:** 2026-11-21 · **Status:** proposed · **Scope:** `infra/claude-cli/{accounts,sdk,availability}`, `conversations/{runtime-sdk,model-provider}`, `infra/claude-cli/usage-ledger/pricing`, runtime-sdk web (account menu)

## Context

equin's model traffic has exactly one connection point: the bundled Claude Code
executable, driven through the Agent SDK. Every LLM session — conversation
agents, one-shot generations (`runClaudePrint`/`runClaudeReadOnly`), the
availability probe, model-menu discovery, usage probes — opens through
`claudeSessionEnv` + `claudeQuery`
(`plugins/infra/plugins/claude-cli/plugins/sdk/server/internal/session.ts:39,79`),
and the CLI child's environment carries the credential
(`claudeCredentialEnv`, `accounts/core/internal/accounts.ts:65`, sets
`ANTHROPIC_API_KEY`). There is no other LLM API in the repo.

Claude Code natively supports any **Anthropic-compatible endpoint** via
`ANTHROPIC_BASE_URL` (+ `ANTHROPIC_AUTH_TOKEN`). Local stacks that speak the
Anthropic Messages API: **LiteLLM** (bridges Ollama / vLLM / LM Studio /
OpenAI), **LM Studio** (serves `/v1/messages` directly), **vLLM** (via
LiteLLM). Goal: let a locally-hosted model server serve equin's agents and
one-shot generations, selected from the existing Claude-account UI.

**Design: an endpoint is a new *account kind*, not a new subsystem.** "Which
server am I talking to" is the same question as "which account do I run on"
for session env, so the whole existing machinery (active selection, per-agent
credential hand-off, launch gate, health row, account menu) works unchanged.
The historical `kind` field on the accounts file (dropped plan-token accounts)
establishes the discriminator.

Chosen model strategy (**B**, user decision): the picker keeps Claude
families; an endpoint account carries an optional `modelMap`
(family → local model name) applied at launch, so `--model` becomes the mapped
local name. No model-provider grammar change; catalog discovery stays
system-account-only (it reads the CLI menu, which for the endpoint would be
the router's alias table at best).

## Core decisions

### 1. Account kind + credential shape

- `ClaudeAccountSchema` (accounts/core) gains
  `kind: z.enum(["api-key", "endpoint"])` — `api-key` for every existing
  account. `ClaudeAccountsSchema` unchanged otherwise.
- Endpoint display data is **non-secret**: `baseUrl` (http/https URL,
  validated) and `modelMap` (`Partial<Record<ModelTier, string>>`, a handful
  of named values) live in `accounts.json` beside `kind` — the `claude-accounts`
  live value drives the UI without touching the secrets store.
- The **token** stays in the secrets store under the same layout as API keys
  (namespace `claude-accounts`, key = account id; `tokens.ts`). **Required**
  (any non-empty string — local servers accept placeholders like `local`; a
  required token keeps the sign-in check, the chrome guard, and the test
  uniform). An endpoint with no credential to hand the CLI would read as
  `signed-out` in the agent's own initialize check and refuse to start.
- `ClaudeCredentialSchema` (the paste validation) stays for API keys. The
  endpoint gets its own schema (`baseUrl` + token + optional modelMap) — the
  two credential shapes are disjoint, so the add path is a **second endpoint**
  `POST /api/claude-accounts/add-endpoint` (mirrors `addClaudeAccount`), not a
  widened body.
- `claudeAccountCredential(id)` (`accounts/server/internal/tokens.ts:35`)
  returns a discriminated union instead of a bare key string:
  ```ts
  type ClaudeCredential =
    | { kind: "api-key"; key: string }
    | { kind: "endpoint"; baseUrl: string; token: string; modelMap?: ModelMap };
  // system account: null (unchanged)
  ```
  Composed from the accounts-file row (kind/baseUrl/modelMap) + the secret
  (token); the existing "secret gone → throw" and "not an API key → throw"
  checks become kind-aware. The file row and the secret are written and
  deleted together (add/remove only — no edit endpoints), so they cannot
  drift.
- New env builder beside `claudeCredentialEnv`: `claudeEndpointEnv(base, ep)`
  — strips `CLAUDE_CREDENTIAL_ENVS`, sets `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_AUTH_TOKEN`. **Extend `CLAUDE_CREDENTIAL_ENVS`** with
  `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` (today only
  `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` are stripped; those two are the
  vars that sign Claude Code in from a custom endpoint, and the
  chrome-needs-system-account guard (`accounts/guard/index.ts:13`) reads the
  same list — an endpoint session must read as non-system too).

### 2. The env seam: one composition point

`claudeSessionEnv(account, base)` (`sdk/…/session.ts:39`) is where the
credential becomes env; extend it to branch on the credential kind. To let
callers that need *both* the env and the credential (model mapping, §3) read
the secret once, factor:

```ts
claudeSessionEnv(account, base?)  // = envFromCredential(await claudeAccountCredential(account), base)
export function envFromCredential(base, credential | null): ClaudeSessionEnv
```

Callers: `bin/agent.ts:148` and `invokeClaude` (`run-claude-print.ts:138`)
switch to reading the credential once and calling `envFromCredential`; the
probe / sign-in / usage-probe keep `claudeSessionEnv`.

### 3. Strategy B — modelMap overlay (two conversion sites, verified complete)

`cliFlagFor(id)` → `claude-<id>` (model-provider/core/registry.ts:107) is the
only id→CLI-flag converter; the `no-raw-model-flags` check keeps it that way.
Exactly two production sites turn a model into a CLI value:

1. **Agent launches** — `sdkLaunchOptions`
   (`conversations/plugins/runtime-sdk/server/internal/launch-options.ts:78`):
   every create / auto-start / roster / triage / sonata / ask / supervisor
   launch funnels through `prepareConversation` → spawn job / inline →
   `sdkRuntime.create` → `sdkLaunchOptions` → launch.json →
   `bin/agent.ts:499` → `--model`.
2. **One-shot tiers** — `invokeClaude`
   (`infra/claude-cli/server/internal/run-claude-print.ts:146`): `tier` →
   `requireModel(tier, catalog)` → `cliFlagFor` (covers all 16
   `runClaudePrint`/`runClaudeReadOnly` call sites).

**New pure helper** in model-provider/core (keeps model-provider
account-agnostic — it takes the map as plain data):

```ts
/** family of `model` → the local name the endpoint's modelMap names for it, else the CLI flag. */
export function modelFlagForEndpoint(model: ConversationModel, modelMap: ModelMap | undefined): string
```
(`modelMeta(model).family` → map lookup → fallback `cliFlagFor(model)`.)

**Where it applies — the agent process resolves its own model**, not the
backend:

- launch.json's `model` (`AgentLaunchOptionsSchema.model`,
  protocol.ts:354) changes meaning from "the CLI's `--model` value" to
  **the model id that runs** (every writer's source is already an id:
  `prepareConversation.create.model`, `row.model` for retry/resume/relaunch).
  `sdkLaunchOptions` becomes `model: input.model ?? null` (id pass-through);
  `bin/agent.ts:499` resolves at process start — where the account (`args.account`)
  and the credential already meet (it fetches the credential itself, :148):
  `options.model ? modelFlagForEndpoint(parse(options.model) ?? …, cred?.modelMap) ?? cliFlagFor(…) : …`.
  This covers fresh launch, retry, resume, **and account-move relaunch**
  (a moved agent re-maps under its *new* account — mapping at launch time
  would strand a mapped name on the wrong server) with no account plumbing
  into `SdkLaunchInput` and no race between two `nextLaunchAccount()` reads.
- `invokeClaude`: `accountId` is resolved at :134, three lines above the
  conversion — fetch the credential once (shared with the env, §2) and
  `model: modelFlagForEndpoint(resolvedModel, cred?.modelMap)`.
- `setModel` protocol command (protocol.ts:76): no equin sender exists today
  (agent.ts:658 handler only) — leave it; note that a future sender must send
  an id and have the agent map it.
- Display values that store a flag (`summary/mcp-tools.ts:108` — the summary
  row; `claude_cli_calls.model` stores the id already) are cosmetic only: a
  summary under an endpoint shows the Claude id. Accept for v1; the usage
  ledger's token rows (keyed by the model name the CLI reports) hold the truth.
- Pinned ids: `assertChoiceLaunchable`/`requireModel` keep validating against
  the Claude catalog for **all** accounts (a pinned id a local router wouldn't
  accept still 409s — correct: the catalog is the truth of what this machine's
  CLI offers, and the map only renames). Families always resolve, so a
  mapped family is always launchable.

**modelMap validation** (add-endpoint body + form): values are non-empty
strings; **reject values matching `^claude-`** — pricing's `resolveModel`
does bidirectional substring matching and would silently price a local model
named `claude-…` at Anthropic rates (pricing.ts:78-94).

### 4. Availability: the endpoint is tested, not assumed

- The machine probe (`probeClaudeCode`, availability/server/internal/probe.ts)
  stays system-account-only — the health row describes the computer's login.
  The launch gate (`checkLaunchReadiness`) already returns `ready` for any
  added account with zero probes (launch-readiness.test.ts pins this) — an
  endpoint inherits that; a dead endpoint fails loudly at agent start (the
  agent's own initialize check, bin/agent.ts:575).
- **New: `POST /api/claude-accounts/test`** (machine): body = the endpoint
  shape (unsaved). Builds the endpoint env (no account, no secret), runs
  `readClaudeInitialize` (CLI sanity, ~2 s) **and one minimal turn** (a short
  prompt, `tools: []`, tight deadline) so the test proves the full path —
  reachability, auth, model acceptance — and returns the reply's words.
  `add-endpoint` runs this test **before saving**: a broken endpoint is never
  stored (fail loudly at the boundary). The form's Test button calls the same
  endpoint.
- `noteClaudeCodeFailure()` re-probes the **system** account today, wherever
  the failure was (run-claude-print.ts:156,162; sdk-runtime launchAgent). An
  endpoint failure would file false signal about the computer's login: pass
  the failing account and only re-probe when it is `SYSTEM_ACCOUNT_ID`.
- `statusOfInitialize` needs no change: a token present ⇒ `tokenSource`
  reported ⇒ `ready`.

### 5. Metered-free classification (no limit holds, no report storms)

- **`startUsageOnProbe`** (runtime-sdk/machine/internal/usage-probe.ts:103):
  reads the *active* account's plan limits after every Claude Code probe.
  Add: **skip non-system accounts** — they have no plan limits (API keys
  already answer `unavailable` and are never written; endpoints would hit the
  local server's `get_usage` for nothing, and a malformed reply would file a
  `crash`/`ClaudeUsageReadFailed` per probe). Behavior-identical for API-key
  accounts, structurally correct for endpoints. (On-demand
  `POST /api/claude-usage/refresh` for the account picker stays — it answers
  `unavailable` for endpoints and is user-triggered.)
- `limit-hold` / `heldAtClaudeLimit`: no change — no usage file ⇒ no hold ⇒
  jobs proceed. A local server that names an error `rate_limit` with no
  readable limits still throws `UnplacedClaudeLimitError` (loud, correct).
- **Pricing** (`usage-ledger/plugins/pricing`): `cost_usd NULL ≠ 0` is a hard
  invariant; an unresolvable local model name (e.g. `qwen3-coder`) would file
  a standing `cost-unpriced-model` row per model. Fix at the rung above: when
  tokens are recorded **under an endpoint account**, the rate-recording path
  (`ensureModelRates` → `priceModels`, called by every ledger writer) records
  a **zero-rate correction** entry for that model name once (the price-table
  system's existing `correction` source — merge-only, never dropped).
  Endpoint tokens then cost `$0` by construction and file no report.
- **Spend** (`tasks/supervisor-roles/spend`): display-only, no gating —
  endpoint renders as a metered 7-day window; cosmetic label ("billed API
  usage" → "local endpoint") in `web/internal/windows.ts`.
- **Account display** (`runtime-sdk/web/internal/account-views.ts`): endpoint
  rows get `detail: "Local endpoint"` (or the baseUrl host) instead of
  `detail: "API key"`; `metered: true` stands (drives all the limit/skip
  logic correctly). `WeekRoomGlance`/glance components driven by
  `AccountView` follow.
- Auto-resume: `limitReached(undefined) === null` ⇒ no spurious resume; the
  resume turn text ("Quota is back…") is only reached for a genuinely
  limit-stopped agent — none for endpoints.

## Changes by plugin

| Plugin | Files (representative) | Change |
|---|---|---|
| `infra/claude-cli/accounts` core | `core/internal/accounts.ts`, `core/index.ts` | `kind` on `ClaudeAccountSchema`; endpoint credential schema (baseUrl/token/modelMap); `ClaudeCredential` union; `claudeEndpointEnv`; `CLAUDE_CREDENTIAL_ENVS` += 2 vars; export `ModelMap` type (or import from model-provider/core — prefer the latter: one definition) |
| `infra/claude-cli/accounts` machine | `machine/internal/accounts-file.ts`, `store.ts`, `routes.ts`, `index.ts`, `internal/test.ts` (new) | `AccountsFileSchema` `kind` enum += `"endpoint"` (**strict today — must land first**); `accountsFileOf` stamps the row's kind; `addClaudeEndpointWithCredential` (test-then-save, secret + file row in one `changeAccounts` write); new `test` endpoint handler |
| `infra/claude-cli/accounts` server | `server/internal/tokens.ts` | `claudeAccountCredential` → union (kind-aware validation) |
| `infra/claude-cli/accounts` guard | `guard/index.ts` | env check picks up the two new vars (free via the extended `CLAUDE_CREDENTIAL_ENVS`) |
| `infra/claude-cli/sdk` | `server/internal/session.ts` | `claudeSessionEnv` branches on kind; new `envFromCredential` export |
| `infra/claude-cli/availability` | `server/internal/status.ts` | `noteClaudeCodeFailure` gains the failing-account gate (system-only re-probe) |
| `conversations/model-provider` core | `core/registry.ts` (or new `core/internal/endpoint-models.ts`) | `ModelMap` type + `modelFlagForEndpoint` (pure) |
| `conversations/runtime-sdk` | `server/internal/launch-options.ts:78`; `core/protocol.ts:354` (annotation); `bin/agent.ts:499` | `model` carries the id; agent maps under its own account at process start |
| `conversations/runtime-sdk` machine | `machine/internal/usage-probe.ts:103` | skip non-system accounts in `startUsageOnProbe` |
| `infra/claude-cli` server | `server/internal/run-claude-print.ts:134-146` | credential read once → env + `modelFlagForEndpoint` |
| `infra/claude-cli/usage-ledger/pricing` | `pricing/server/internal/versions.ts`, `pricing.ts` | zero-rate correction for models observed under an endpoint account |
| `conversations/runtime-sdk` web | `components/claude-accounts.tsx`, `internal/account-views.ts` | "Add endpoint" form (name, base URL, token, collapsible modelMap rows for haiku/sonnet/opus/fable; URL + `claude-`-prefix validation; Test button; Add = test-then-save via `add-endpoint`); endpoint `detail` label |
| docs | accounts/sdk/runtime-sdk CLAUDE.md prose, `research/` pointer | endpoint kind, env vars, local-server compatibility notes (LiteLLM/LM Studio/Ollama-via-LiteLLM config sketches; SSRF note: the CLI dials the URL directly — the user's own trust boundary, shape-validated only) |

Boundary notes: accounts/core → model-provider/core for `ModelTier`/`ModelMap`
is a new import edge (infra → conversations already exists: claude-cli uses
model-provider's catalog) — confirm with `./equin check boundary-rules`; the
alternative is defining `ModelMap` in accounts/core as plain data
(`Partial<Record<string, string>>` keyed by tier names) and letting
model-provider read it — implementer picks whichever passes cleanly.

## Verification

1. **Unit:** extend `accounts/core/internal/accounts.test.ts` (endpoint
   schema, `claudeEndpointEnv` strip/set, union resolution),
   `accounts-file.test.ts` (kind round-trip, legacy file unchanged),
   model-provider registry test for `modelFlagForEndpoint`, runtime-sdk
   launch-options/protocol tests (id pass-through), usage-probe skip
   (mocked active account), `launch-readiness.test.ts` (endpoint inherits
   zero-probe readiness).
2. **Live endpoint:** stand up a local Anthropic-compatible server (user's
   LiteLLM/Ollama/LM Studio if available; else a minimal bun mock in
   `$EQUIN_SCRATCH` answering `/v1/messages` with canned Anthropic-shaped
   SSE). `./equin build`, then drive the app (browser MCP / screenshot.ts):
   - Add endpoint with a bad URL → Test fails, nothing stored.
   - Add a working endpoint (modelMap `sonnet → <local model>`) → Test green,
     row shows "Local endpoint".
   - Launch a conversation on it → transcript streams from the local model;
     agent pid file names the endpoint account; health row stays ok.
   - One-shot (`runClaudePrint` via any background job, e.g. a task title) →
     `claude_cli_calls` row shows the family id; usage ledger rows carry the
     local model name at $0; no `cost-unpriced-model` / `ClaudeUsageReadFailed`
     reports fire; no `UnplacedClaudeLimitError`.
   - Switch back to the system account → agents relaunch on the computer's
     login; mapped names never leak to Anthropic (the agent maps under its own
     account at start).
3. `./equin check` (boundary-rules, plugin-boundaries, type-check, lint incl.
   `no-raw-model-flags`, `claude-sdk/*` lint rules) + `./equin test` on the
   touched plugins.

## Risks / open questions

- **What `initialize` reports for a third-party endpoint** (account fields
  come from the CLI's own auth config; a token ⇒ `tokenSource` ⇒ ready) —
  the live test in verification step 2 confirms; if a router swallows auth
  in a way that reports nothing, the Test-turn catches it with the CLI's own
  words.
- **Proxy model-menu fidelity** — catalog discovery stays system-account; an
  endpoint's menu is irrelevant to launches under Strategy B.
- **`--effort` / thinking flags** against local models — a property of the
  CLI build + router; surfaced loudly if the router rejects them (first-turn
  error), user picks a compatible effort level.
- **Keyless endpoints** deliberately unsupported (token required) — see
  §1; revisit only if a common local server rejects all tokens.

## Out of scope (Phase 2, later)

First-class endpoint model ids: extend `ConversationModelSchema` with a second
grammar form (raw endpoint model names, branded), catalog discovery on
endpoint accounts (`source: "endpoint"`), pickers offering the endpoint's own
model list, `add_task`'s MCP model enum gaining those names. Strategy B's
modelMap is the contained substitute until that's needed.
