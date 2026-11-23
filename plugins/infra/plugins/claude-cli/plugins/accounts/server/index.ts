import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  claudeAccountCredential,
  claudeAccountIsEndpoint,
  claudeAccountModelMap,
  claudeEndpointToken,
  deleteClaudeAccountCredential,
  endpointAccountModels,
  saveClaudeAccountCredential,
} from "./internal/tokens";
export { ActiveClaudeAccount, activeClaudeAccountId } from "./internal/active";
export type { ActiveClaudeAccountImpl } from "./internal/active";
export { ClaudeAccountsFile, readAccountsFile } from "./internal/accounts-file";
export type { ClaudeAccountsFileImpl } from "./internal/accounts-file";

export default {
  description:
    "The Claude accounts' credentials, every host's half: each added account's credential in the secrets store — an API key for a key account, the bearer token for an endpoint account that has one (saved, deleted, and read by the agent at its start: claudeAccountCredential, null for the computer's own Claude Code login, a loud error when an added account is gone) — and the machine-wide accounts file read through the ClaudeAccountsFile host service (the machine half provides it: the file's schema and parse live in core) — what reads it here: claudeAccountModelMap (an endpoint's family → model name map), claudeAccountIsEndpoint (whether the account serves a local model server — the one-shot generation widens its bound for it) and endpointAccountModels (every mapped model name, the zero-rate price rows' set).",
} satisfies ServerPluginDefinition;
