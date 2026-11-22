# Claude accounts

The Claude accounts agents can run on, and which one new agents launch on.

- **The system account** (`SYSTEM_ACCOUNT_ID`) is always there: whatever the computer's Claude Code is signed into (signed in from the app: `claude-cli/sign-in`). It has no credential here — Claude Code stores its own login. **It is the only plan (subscription) account**: to run on another plan, sign the computer in to it.
- **Added accounts are API keys or local endpoints**, one `kind` each:
  - **API keys** (`sk-ant-api…` or, for keys the Console creates since ~2026-10, `sk-ant-usr…` — `API_KEY_PREFIXES`; pasted — the menu's "Add an API key"): billed per use to its Console organization — e.g. the monthly API credit a Max / Team plan includes once a Console org is linked (claude.ai → Settings → Billing → API credits). No plan limits, so **metered**.
  - **Local endpoints** (`ClaudeEndpointSettings`: `api` `openai` | `anthropic` — OpenAI-compatible by default, the common local shape — `baseUrl`, optional `modelMap`): a model server the user runs (Ninfer, LM Studio, Ollama, …). An `openai` endpoint is addressed at equin's translator proxy (`claude-cli/llm-proxy`, `llmProxyUrl(id)` — the address contract lives HERE, in core, so the credential can name it without this plugin importing the proxy); an `anthropic` one is addressed at itself. The `modelMap` (families → the server's own model names, a `claude-…` value refused) is applied at the launch (`modelFlagForEndpoint`, `conversations/model-provider`): an unmapped family runs as its Claude flag, which a server that does not serve it rejects loudly. Its token (when it has one) goes to the secrets store like a key; the file keeps settings only.

  The key / token goes to the secrets store (namespace `claude-accounts`, key = account id); `accounts.json` (data-dir `state/claude-accounts`) holds only names, settings and the active id.
- **No added plan accounts.** equin once signed in to more plans (`setup-token`) and kept their tokens. Anthropic's terms say developers may not "collect, store, or intermediate Claude.ai credentials or session tokens", so that is gone (2026-11) and must not come back. An older `accounts.json` may still hold such accounts (`kind: "token"`, or no `kind`): the read ignores them (an active one falls back to the system account), and the machine half's `onReady` (`retirePlanAccounts`) removes them and deletes their tokens. `claudeAccountCredential` refuses a secret that is not an API key.
- **Machine-wide.** Every worktree's agents launch on the active account. The choice is read at agent-process start (`runtime-sdk`), which passes the account id to the agent; the agent fetches the credential itself (`claudeAccountCredential`) and hands it to Claude Code through `claudeAccountEnv` — the key as `ANTHROPIC_API_KEY`, the endpoint's base URL as `ANTHROPIC_BASE_URL` (plus `ANTHROPIC_AUTH_TOKEN` — the endpoint's token when it has one, else the `equin-local` placeholder: with no auth variable at all Claude Code declines the turn on its own login check before the base URL is reached — its mapped haiku as the small fast model) — every other credential variable (`CLAUDE_CODE_OAUTH_TOKEN` included) removed. The credential never sits in argv, the options file or the login shell's environment.
- A running agent keeps the account it started on until its process restarts.
- **Never switched automatically.** New agents launch on the account the user made active, and nothing moves them to another account because a limit was reached — a limit is waited out (`runtime-sdk`'s auto-resume, `heldAtClaudeLimit`). Plan limits "assume ordinary, individual usage" (the Claude Code legal page), so the auto-switch that once moved agents off a spent account (`autoSwitch`, removed 2026-11) must not come back; the limit banner's "Continue on …" is a developer-only manual switch.
- **An added account has no Claude-in-Chrome** (nor claude.ai connectors): its credential carries no claude.ai sign-in, and Claude Code drops them silently, `--chrome` or not. The `chrome-needs-system-account` guard (`guard/`) tells an agent so the first time it ToolSearches for Chrome — only then, to keep it out of every other session's context.
- **One-shot generations follow it too.** Titles, summaries, triage — every `runClaudePrint` / `runClaudeReadOnly` — run on `activeClaudeAccountId()` (the `ActiveClaudeAccount` host service, which the machine half provides from the accounts file), through `claudeSessionEnv` (`claude-cli/sdk`), the same environment builder agents use; on an endpoint account the tier runs as that account's mapped model (`modelFlagForEndpoint`, the map read beside the account id), exactly as an agent's launch.
- Usage limits are per account and recorded by `conversations/runtime-sdk` (it owns the rate-limit events); the health row's account picker lives there too. **Only the system account has plan limits** — an added account (key or endpoint) answers no `get_usage` at all, so the usage probe skips it (a failed read would file a report on every probe); its spend, when it has any, reads through the usage ledger as before.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The Claude accounts' credentials, every host's half: each added account's credential in the secrets store — an API key for a key account, the bearer token for an endpoint account that has one (saved, deleted, and read by the agent at its start: claudeAccountCredential, null for the computer's own Claude Code login, a loud error when an added account is gone) — and the machine-wide accounts file read through the ClaudeAccountsFile host service (the machine half provides it: the file's schema and parse live in core) — what reads it here: claudeAccountModelMap (an endpoint's family → model name map) and endpointAccountModels (every mapped model name, the zero-rate price rows' set).
- Server:
  - Contributes:
    - `resource.declare` "claude-accounts"
    - `host-service:claude-accounts.active` "claude-accounts.active"
    - `host-service:claude-accounts.file` "claude-accounts.file"
  - Uses:
    - `infra/secrets.deleteSecret`
    - `infra/secrets.getSecret`
    - `infra/secrets.setSecret`
  - Exports (types):
    - `ActiveClaudeAccountImpl`
    - `ClaudeAccountsFileImpl`
  - Exports (values):
    - `ActiveClaudeAccount`
    - `activeClaudeAccountId`
    - `claudeAccountCredential`
    - `claudeAccountModelMap`
    - `ClaudeAccountsFile`
    - `claudeEndpointToken`
    - `deleteClaudeAccountCredential`
    - `endpointAccountModels`
    - `readAccountsFile`
    - `saveClaudeAccountCredential`
  - Resources: `claude-accounts` (push, notified, whole: the Claude accounts the user added by hand — a handful)
- Machine:
  - Uses:
    - `infra/endpoints.implementMachine`
    - `network/live.serveValue`
  - Exports (types): `SystemLogin`
  - Exports (values):
    - `addClaudeAccountWithCredential`
    - `changeClaudeAccounts`
    - `readClaudeAccounts`
    - `readSystemLogin`
    - `selectClaudeAccountById`
    - `watchClaudeAccounts`
  - Routes:
    - `POST /api/claude-accounts/add`
    - `POST /api/claude-accounts/remove`
    - `POST /api/claude-accounts/select`
- Core:
  - Uses:
    - `conversations/model-provider.ModelMap`
    - `conversations/model-provider.ModelMapSchema`
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveValue`
    - `packages/list-bound.wholeList`
  - Exports (types):
    - `AccountsFile`
    - `ClaudeAccount`
    - `ClaudeAccountCredential`
    - `ClaudeAccounts`
    - `ClaudeApiKeyAccount`
    - `ClaudeEndpointAccount`
    - `ClaudeEndpointSettings`
    - `EndpointApi`
  - Exports (values):
    - `ACCOUNTS_FILE_NAME`
    - `accountsFileOf`
    - `addClaudeAccount`
    - `addClaudeEndpoint`
    - `API_KEY_PREFIXES`
    - `CLAUDE_CREDENTIAL_ENVS`
    - `claudeAccountEnv`
    - `claudeAccountIds`
    - `claudeAccounts`
    - `ClaudeAccountSchema`
    - `ClaudeAccountsSchema`
    - `ClaudeApiKeyAccountSchema`
    - `claudeCredentialEnv`
    - `ClaudeCredentialSchema`
    - `ClaudeEndpointAccountSchema`
    - `claudeEndpointEnv`
    - `ClaudeEndpointSettingsSchema`
    - `ENDPOINT_APIS`
    - `LLM_PROXY_PORT`
    - `llmProxyUrl`
    - `mintTestAccountId`
    - `NO_CLAUDE_ACCOUNTS`
    - `parseAccountsFile`
    - `removeClaudeAccount`
    - `selectClaudeAccount`
    - `SYSTEM_ACCOUNT_ID`
    - `TEST_ACCOUNT_ID_PREFIX`
    - `testClaudeEndpoint`
    - `withStandInNames`
- Cross-plugin:
  - Imported by:
    - `conversations/model-provider/catalog`
    - `conversations/runtime-sdk`
    - `conversations/usage`
    - `infra/claude-cli`
    - `infra/claude-cli/availability`
    - `infra/claude-cli/llm-proxy`
    - `infra/claude-cli/sdk`
    - `infra/claude-cli/sign-in`
    - `infra/claude-cli/usage-ledger/pricing/price-table`
    - `tasks/supervisor-roles/spend`
  - Endpoint callers: `llm-proxy`

<!-- AUTOGENERATED:END -->
