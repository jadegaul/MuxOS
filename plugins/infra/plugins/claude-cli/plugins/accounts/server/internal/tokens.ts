import {
  deleteSecret,
  getSecret,
  setSecret,
} from "@plugins/infra/plugins/secrets/server";
import { defineSecretNamespace } from "@plugins/infra/plugins/secrets/core";
import {
  API_KEY_PREFIXES,
  SYSTEM_ACCOUNT_ID,
  TEST_ACCOUNT_ID_PREFIX,
  type ClaudeAccountCredential,
} from "../../core";
import type { ModelMap } from "@plugins/conversations/plugins/model-provider/core";
import { readAccountsFile } from "./accounts-file";

// Each added account's credential, in the
// encrypted secrets store (namespace `claude-accounts`, keyed by account id) —
// an API key for a key account, the bearer token for an endpoint account that
// has one — never in the accounts file (which holds the endpoint's settings).

const TOKENS_NAMESPACE = defineSecretNamespace("claude-accounts", {
  scope: "machine",
});

export async function saveClaudeAccountCredential(
  id: string,
  token: string,
): Promise<void> {
  await setSecret({ namespace: TOKENS_NAMESPACE, key: id }, token);
}

export async function deleteClaudeAccountCredential(id: string): Promise<void> {
  await deleteSecret({ namespace: TOKENS_NAMESPACE, key: id });
}

/**
 * The credential an agent on `id` signs in with: `null` for the system
 * account (Claude Code's own login); an added account's API key, or its
 * endpoint's settings with its bearer token (`null` when the endpoint takes
 * no auth). An added account that the file does not hold throws — an agent
 * must never fall back to another account silently — and so does an API-key
 * account whose secret is gone, or one that holds something that is not an
 * API key: a plan token left from before added plan accounts were removed is
 * never used (`core/internal/accounts.ts`).
 */
export async function claudeAccountCredential(
  id: string,
): Promise<ClaudeAccountCredential | null> {
  if (id === SYSTEM_ACCOUNT_ID) return null;
  const { state } = await readAccountsFile();
  const account = state.accounts.find((a) => a.id === id);
  if (!account) throw new Error(`No Claude account "${id}"`);
  if (account.kind === "api-key") {
    const secret = await getSecret({ namespace: TOKENS_NAMESPACE, key: id });
    if (secret === undefined)
      throw new Error(
        `The credential of Claude account "${id}" is missing from the secrets store — remove the account and add it again`,
      );
    if (!API_KEY_PREFIXES.some((p) => secret.startsWith(p)))
      throw new Error(
        `Claude account "${id}" holds a plan sign-in token, not an API key — equin runs plans only on the computer's own Claude Code login; remove the account`,
      );
    return { kind: "api-key", key: secret };
  }
  const secret = await getSecret({ namespace: TOKENS_NAMESPACE, key: id });
  return {
    kind: "endpoint",
    id,
    api: account.endpoint.api,
    baseUrl: account.endpoint.baseUrl,
    token: secret ?? null,
    ...(account.endpoint.modelMap
      ? { modelMap: account.endpoint.modelMap }
      : {}),
    ...(account.endpoint.contextWindow !== undefined
      ? { contextWindow: account.endpoint.contextWindow }
      : {}),
  };
}

/**
 * The bearer token an endpoint account's server expects (`null` when it takes
 * no auth): the LLM proxy's process reads it per request, beside the
 * account's settings.
 */
export async function claudeEndpointToken(id: string): Promise<string | null> {
  const secret = await getSecret({ namespace: TOKENS_NAMESPACE, key: id });
  return secret ?? null;
}

/**
 * The endpoint account `id`'s model map (its settings live in the accounts
 * file, not the secrets store): `undefined` for every non-endpoint account.
 * A launch's model id runs as the map's name for its family
 * (`modelFlagForEndpoint`) — an agent reads it at its own start, one-shot
 * generations read it here.
 */
export async function claudeAccountModelMap(
  id: string,
): Promise<ModelMap | undefined> {
  if (id === SYSTEM_ACCOUNT_ID) return undefined;
  const { state } = await readAccountsFile();
  const account = state.accounts.find((a) => a.id === id);
  return account?.kind === "endpoint" ? account.endpoint.modelMap : undefined;
}

/**
 * Whether account `id` is a local endpoint — it serves the user's own model
 * server, whose latency is minutes, not seconds (the one-shot generation
 * widens its bound for it, `claude-cli`'s `runClaudePrint`). `false` for the
 * system account and an API-key account, and for an id no longer in the file.
 */
export async function claudeAccountIsEndpoint(id: string): Promise<boolean> {
  if (id === SYSTEM_ACCOUNT_ID) return false;
  const { state } = await readAccountsFile();
  return state.accounts.find((a) => a.id === id)?.kind === "endpoint";
}

/**
 * Every model name an endpoint account's map serves — the union over the
 * endpoint accounts, in file order (the temporary `test-…` rows of an
 * in-flight endpoint test excluded — they are deleted with the test). What
 * the price table cannot know: a local server's own models are not Claude's,
 * so their tokens price at $0 through zero-rate price rows
   (usage-ledger/pricing) instead of filing `cost-unpriced-model`.
 */
export async function endpointAccountModels(): Promise<Set<string>> {
  const { state } = await readAccountsFile();
  const names = new Set<string>();
  for (const account of state.accounts) {
    if (account.id.startsWith(TEST_ACCOUNT_ID_PREFIX)) continue;
    if (account.kind === "endpoint")
      for (const name of Object.values(account.endpoint.modelMap ?? {}))
        if (name !== undefined) names.add(name);
  }
  return names;
}
