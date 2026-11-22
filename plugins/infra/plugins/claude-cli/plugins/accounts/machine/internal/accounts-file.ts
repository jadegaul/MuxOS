import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { readFile } from "@plugins/packages/plugins/timed-fs/core";
import {
  ACCOUNTS_FILE_NAME,
  NO_CLAUDE_ACCOUNTS,
  parseAccountsFile,
  type AccountsFile,
} from "../../core";
import { claudeAccountsDir } from "../../data-dirs";

// The machine-wide accounts file's read (the writes are `store.ts`, which
// rewrites it whole through a rename). The server half reads the same file
// through its host service, whose provider is this machine's read
// (`machine/index.ts`).

/** The accounts file, machine-wide. */
export function claudeAccountsPath(): AppPath {
  return claudeAccountsDir.file(ACCOUNTS_FILE_NAME);
}

/**
 * The accounts file at its machine-wide path: the parsed file, or — a file
 * that does not exist — none added yet (the system account alone).
 */
export async function readAccountsFile(): Promise<AccountsFile> {
  let text: string;
  try {
    text = await readFile(claudeAccountsPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { state: NO_CLAUDE_ACCOUNTS, planAccounts: [] };
    throw err;
  }
  return parseAccountsFile(JSON.parse(text));
}
