import { rename, writeFile } from "node:fs/promises";
import { asAppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";
import {
  accountsFileOf,
  SYSTEM_ACCOUNT_ID,
  type ClaudeAccount,
  type ClaudeAccounts,
} from "../../core";
import { claudeAccountsDir } from "../../data-dirs";
import {
  deleteClaudeAccountCredential,
  saveClaudeAccountCredential,
  type ActiveClaudeAccountImpl,
} from "../../server";
import { claudeAccountsPath, readAccountsFile } from "./accounts-file";

// The accounts file (the credentials are the server half's, in the secrets
// store). Every write replaces the file whole through a rename, so a reader
// (another worktree's launch, the live value's watch) never sees half of it.

/** The accounts as saved; none added yet → the system account alone. */
export async function readClaudeAccounts(): Promise<ClaudeAccounts> {
  return (await readAccountsFile()).state;
}

async function writeClaudeAccounts(state: ClaudeAccounts): Promise<void> {
  await claudeAccountsDir.ensure();
  const path = claudeAccountsPath();
  const tmp = asAppPath(`${path}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(accountsFileOf(state), null, 2));
  await rename(tmp, path);
}

// Every change is read-modify-write of one file: serialized, so two callers
// (the endpoints, an agent launch switching account) never interleave and lose
// one another's change.
const accountsMutex = createKeyedMutex();
const changeAccounts = <T>(fn: () => Promise<T>): Promise<T> =>
  accountsMutex.run("accounts.json", fn);

function assertKnown(state: ClaudeAccounts, id: string): void {
  if (id !== SYSTEM_ACCOUNT_ID && !state.accounts.some((a) => a.id === id))
    throw new Error(`No Claude account "${id}"`);
}

/**
 * A read-modify-write of the accounts file under the change mutex: `fn` sees
 * the file's current accounts and returns what the file then holds. The LLM
 * proxy's endpoint test mints and removes its temporary row this way, beside
 * this half's own changes.
 */
export function changeClaudeAccounts(
  fn: (state: ClaudeAccounts) => ClaudeAccounts | Promise<ClaudeAccounts>,
): Promise<void> {
  return changeAccounts(async () => {
    const state = await readClaudeAccounts();
    await writeClaudeAccounts(await fn(state));
  });
}

export async function addClaudeAccountWithCredential(
  name: string,
  credential: string,
): Promise<ClaudeAccount> {
  const account: ClaudeAccount = {
    id: `acct-${crypto.randomUUID().slice(0, 8)}`,
    name,
    addedAt: Date.now(),
    kind: "api-key",
  };
  // The credential first: an account in the list always has one.
  await saveClaudeAccountCredential(account.id, credential);
  await changeClaudeAccounts((state) => ({
    ...state,
    accounts: [...state.accounts, account],
  }));
  return account;
}

export async function removeClaudeAccountById(id: string): Promise<void> {
  if (id === SYSTEM_ACCOUNT_ID)
    throw new Error("The computer's own Claude Code account can't be removed");
  await changeClaudeAccounts(async (state) => {
    assertKnown(state, id);
    return {
      ...state,
      accounts: state.accounts.filter((a) => a.id !== id),
      active: state.active === id ? SYSTEM_ACCOUNT_ID : state.active,
    };
  });
  await deleteClaudeAccountCredential(id);
}

export function selectClaudeAccountById(id: string): Promise<void> {
  return changeAccounts(async () => {
    const state = await readClaudeAccounts();
    assertKnown(state, id);
    if (state.active !== id)
      await writeClaudeAccounts({ ...state, active: id });
  });
}

/**
 * Removes the plan accounts an older accounts file still holds, and their
 * tokens from the secrets store (boot, `onReady`). The read already ignores
 * them, so this only reclaims what they left; every backend runs it, and a
 * second run finds nothing.
 */
export async function retirePlanAccounts(): Promise<void> {
  const retired = await changeAccounts(async () => {
    const { state, planAccounts } = await readAccountsFile();
    if (planAccounts.length > 0) await writeClaudeAccounts(state);
    return planAccounts;
  });
  for (const id of retired) await deleteClaudeAccountCredential(id);
}

/** The ActiveClaudeAccount host service on the desktop: the file's choice, read now. */
export const activeAccountFromFile: ActiveClaudeAccountImpl = {
  id: async () => (await readClaudeAccounts()).active,
};
