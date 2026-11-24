import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  addClaudeAccount,
  removeClaudeAccount,
  selectClaudeAccount,
} from "../core";
import { handleAdd, handleRemove, handleSelect } from "./internal/routes";
import { claudeAccountsServed } from "./internal/served";
import { readAccountsFile } from "./internal/accounts-file";
import { activeAccountFromFile, retirePlanAccounts } from "./internal/store";
import { ActiveClaudeAccount, ClaudeAccountsFile } from "../server";

export {
  addClaudeAccountWithCredential,
  changeClaudeAccounts,
  readClaudeAccounts,
  selectClaudeAccountById,
} from "./internal/store";
export { watchClaudeAccounts } from "./internal/watch";
export { readSystemLogin } from "./internal/system-login";
export type { SystemLogin } from "./internal/system-login";

export default {
  description:
    "The Claude accounts, desktop-only half: the machine-wide accounts file (each added account — an API key or a local model endpoint — its name, an endpoint's settings, the active one — readClaudeAccounts, selectClaudeAccountById, changeClaudeAccounts for a read-modify-write under the change mutex), served as the claude-accounts push value off a watch of it (an endpoint test's temporary row excluded), the active one provided as the ActiveClaudeAccount host service and the file itself as the ClaudeAccountsFile host service (the server half's read of it: a credential's account kind, an endpoint's model map, the zero-rate price rows' set), the add / remove / select endpoints that rewrite it (a key or an endpoint token goes to the secrets store), watchClaudeAccounts — a callback on every rewrite of the file, from any backend — and readSystemLogin: the claude.ai account the computer's Claude Code is signed into (its user config's oauthAccount.accountUuid), the uuid a transcript's session-owner record names. An endpoint's test / add-endpoint routes are the LLM proxy half's (claude-cli/llm-proxy). At boot it removes the plan accounts an older accounts file still holds, with their tokens (retirePlanAccounts): muxos runs plans only on the computer's own login.",
  onReady: retirePlanAccounts,
  httpRoutes: {
    [addClaudeAccount.route]: handleAdd,
    [removeClaudeAccount.route]: handleRemove,
    [selectClaudeAccount.route]: handleSelect,
  },
  contributions: [
    ...claudeAccountsServed.declare,
    ActiveClaudeAccount.provide(activeAccountFromFile),
    ClaudeAccountsFile.provide({ read: readAccountsFile }),
  ],
} satisfies MachinePluginDefinition;
