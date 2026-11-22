import {
  SYSTEM_ACCOUNT_ID,
  type ClaudeAccounts,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/core";
import type { ClaudeCodeStatus } from "@plugins/infra/plugins/claude-cli/plugins/availability/core";

// The Claude accounts as every surface lists them: the computer's own login
// first, then the added ones — each with a name and one line of detail.

/**
 * What an account is: the computer's own Claude Code login — the one PLAN
 * account, whose limits are the ones to read — or an added account, which has
 * no plan limits: an API key (billed per use to its Console org) or a local
 * model endpoint (self-hosted; its tokens run at $0).
 */
export type AccountKind = "login" | "api-key" | "endpoint";

export interface AccountView {
  id: string;
  name: string;
  detail: string;
  kind: AccountKind;
  /** No plan limits to read or show — every added account (key and endpoint). */
  metered: boolean;
}

/** The accounts in display order: the computer's own login first. */
export function accountViews(
  accounts: ClaudeAccounts,
  claude: ClaudeCodeStatus,
): AccountView[] {
  const login =
    claude.kind === "ready"
      ? (claude.email ?? claude.authMethod ?? "Claude Code's sign-in")
      : "Claude Code's sign-in";
  return [
    {
      id: SYSTEM_ACCOUNT_ID,
      name: "This computer",
      detail: login,
      kind: "login",
      metered: false,
    },
    // Added accounts: API keys and local model endpoints (`infra/claude-cli/accounts`).
    ...accounts.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      detail: a.kind === "endpoint" ? "Local endpoint" : "API key",
      kind: a.kind,
      metered: true,
    })),
  ];
}

/** The account new agents launch on, as listed. */
export function activeAccountView(
  accounts: ClaudeAccounts,
  views: readonly AccountView[],
): AccountView {
  const active = views.find((v) => v.id === accounts.active);
  if (!active) {
    throw new Error(
      `Claude accounts: the active account "${accounts.active}" is not one of ${views.map((v) => v.id).join(", ")}`,
    );
  }
  return active;
}
