import { wholeList } from "@plugins/packages/plugins/list-bound/core";
import { z } from "zod";
import {
  ClaudeAccountSchema,
  SYSTEM_ACCOUNT_ID,
  type ClaudeAccount,
  type ClaudeAccounts,
} from "./accounts";

// The accounts file (`state/claude-accounts/accounts.json`): machine-wide,
// rewritten whole through a rename by whichever backend changed it. This file
// is its pure half — the schema, the parse of what an older file still holds,
// and what a write holds — shared by the machine half (the read and the
// writes, `machine/internal/accounts-file.ts`) and the LLM proxy's process
// (which reads the file itself, `claude-cli/llm-proxy/bin`).

export const ACCOUNTS_FILE_NAME = "accounts.json";

/**
 * One account row as a file holds it: a modern row (either kind, exactly as in
 * memory) or a legacy one — no `kind` at all (a plan sign-in, from before API
 * keys) or `kind: "token"` / `"api-key"`. A `kind: "endpoint"` row without its
 * settings parses as nothing: that is corruption, and the read throws.
 */
const FileAccountSchema = z.union([
  ClaudeAccountSchema,
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    addedAt: z.number().int().positive(),
    kind: z.enum(["token", "api-key"]).optional(),
  }),
]);

const AccountsFileSchema = z.object({
  accounts: wholeList(FileAccountSchema, {
    reason: "the Claude accounts the user added by hand — a handful",
  }),
  active: z.string().min(1),
});

/**
 * The accounts file read: the accounts agents may run on (`state`), and the
 * ids of the plan accounts an older file still holds (`planAccounts`) — never
 * run on, the active choice falling back to the computer's own login when it
 * named one.
 */
export interface AccountsFile {
  state: ClaudeAccounts;
  planAccounts: string[];
}

export function parseAccountsFile(json: unknown): AccountsFile {
  const file = AccountsFileSchema.parse(json);
  const accounts: ClaudeAccount[] = [];
  const planAccounts: string[] = [];
  for (const row of file.accounts) {
    if ("endpoint" in row) {
      // A modern endpoint row: its settings came through with it.
      accounts.push(row);
      continue;
    }
    // An absent `kind` is a plan sign-in — the only kind files held before
    // API keys, so "no kind" and `token` retire alike.
    const kind = row.kind ?? "token";
    if (kind === "token") {
      planAccounts.push(row.id);
    } else {
      accounts.push({
        id: row.id,
        name: row.name,
        addedAt: row.addedAt,
        kind: "api-key",
      });
    }
  }
  return {
    state: {
      accounts,
      active: planAccounts.includes(file.active)
        ? SYSTEM_ACCOUNT_ID
        : file.active,
    },
    planAccounts,
  };
}

/** What the file holds for `state`: the rows are already in the file's shape. */
export function accountsFileOf(state: ClaudeAccounts): unknown {
  return state;
}
