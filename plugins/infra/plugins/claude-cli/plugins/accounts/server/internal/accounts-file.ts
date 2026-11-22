import { defineHostService } from "@plugins/framework/plugins/server-core/core";
import type { AccountsFile } from "../../core";

// The machine-wide accounts file, read by the server half. The choice lives
// in a file on the computer, so the desktop's provider (`accounts#machine`)
// reads it there; the server code only asks for it — an agent's credential
// (which kind of account it is, an endpoint account's settings), the model
// map applied at a launch, and the zero-rate price rows' set of local model
// names. None of those readers runs on a host without the computer.

export interface ClaudeAccountsFileImpl {
  read(): Promise<AccountsFile>;
}

export const ClaudeAccountsFile = defineHostService<ClaudeAccountsFileImpl>(
  "claude-accounts.file",
);

/** The accounts file read now. */
export function readAccountsFile(): Promise<AccountsFile> {
  return ClaudeAccountsFile.get().read();
}
