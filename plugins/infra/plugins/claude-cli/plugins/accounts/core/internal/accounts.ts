import { z } from "zod";
import { liveValue } from "@plugins/network/plugins/live/core";
import { wholeList } from "@plugins/packages/plugins/list-bound/core";
import { defineEndpoint } from "@plugins/infra/plugins/endpoints/core";
import {
  ModelMapSchema,
  type ModelMap,
} from "@plugins/conversations/plugins/model-provider/core";
import { llmProxyUrl } from "./llm-proxy-address";

// The Claude accounts agents can run on. One is always there: the account the
// computer's Claude Code is signed into (its keychain; signed in from the app,
// `claude-cli/sign-in`) — the only plan (subscription) account equin runs on.
// The others are either Anthropic API keys (billed per use to their Console
// org, e.g. the plan's monthly API credit), pasted by the user; the key lives
// in the encrypted secrets store, never in this list — or local model
// endpoints (the user's own OpenAI-compatible or Anthropic-compatible server:
// Ninfer, LM Studio, Ollama, …), addressed in the accounts file, their bearer
// token (when they have one) in the secrets store. An OpenAI-compatible
// endpoint is reached through equin's local translator proxy
// (`claude-cli/llm-proxy`) — the ANTHROPIC_BASE_URL an agent on it gets is the
// proxy's, not the endpoint's own. The choice is the machine's — every
// worktree's agents launch on the active account.
//
// No added plan accounts. equin once signed in to more plans (Claude Code's
// `setup-token`) and kept their tokens; Anthropic's terms say developers may
// not "collect, store, or intermediate Claude.ai credentials or session
// tokens", and plan limits "assume ordinary, individual usage". A plan account
// is Claude Code's own login, which Claude Code stores itself. Files written
// before hold such accounts; the server half drops them (accounts-file.ts).

/** The account the computer's Claude Code is signed into. */
export const SYSTEM_ACCOUNT_ID = "system";

/**
 * The id prefix of the temporary rows an endpoint test mints in the accounts
 * file (one turn on the endpoint, then deleted): the served value and the
 * price reader skip them, and nothing launches on one — a live agent would
 * find its credential deleted mid-turn.
 */
export const TEST_ACCOUNT_ID_PREFIX = "test-";

/** The id a temporary test account row takes (`test-…`, eight random chars). */
export function mintTestAccountId(): string {
  return `${TEST_ACCOUNT_ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * What an API key starts with: `sk-ant-api` is the original shape; keys the
 * Console creates since ~2026-10 (personal / workspace keys) start with
 * `sk-ant-usr`.
 */
export const API_KEY_PREFIXES = ["sk-ant-api", "sk-ant-usr"] as const;

/** The variable an added account's API key reaches Claude Code in. */
const API_KEY_ENV = "ANTHROPIC_API_KEY";

/**
 * Every variable that signs Claude Code in from the environment, removed from
 * an agent's environment but for the one its account sets — so a variable
 * inherited from elsewhere can never sign an agent in as another account.
 * `CLAUDE_CODE_OAUTH_TOKEN` (a plan token) is never set by equin, only
 * stripped. Its presence is also how a session knows it does not run on the
 * computer's own login (`guard/`). The two endpoint variables are stripped
 * alike: an endpoint account is the only one that sets them.
 */
export const CLAUDE_CREDENTIAL_ENVS: readonly string[] = [
  API_KEY_ENV,
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
];

/**
 * What a user pastes: an API key (`sk-ant-api…` / `sk-ant-usr…`). Checked
 * for its shape only: whether it still signs in shows on the first agent
 * launched with it.
 */
export const ClaudeCredentialSchema = z
  .string()
  .trim()
  .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, "Not a Claude credential (sk-ant-…)")
  .refine(
    (s) => API_KEY_PREFIXES.some((p) => s.startsWith(p)),
    "Not an API key (sk-ant-api… / sk-ant-usr…)",
  );

/**
 * Claude Code's environment for an added account's `apiKey`: `base` without
 * any credential variable, plus the API key.
 */
export function claudeCredentialEnv(
  base: Readonly<Record<string, string | undefined>>,
  apiKey: string,
): Record<string, string | undefined> {
  const env = { ...base };
  for (const name of CLAUDE_CREDENTIAL_ENVS) delete env[name];
  env[API_KEY_ENV] = apiKey;
  return env;
}

// ── Local model endpoints ──────────────────────────────────────────────────
//
// An endpoint account points Claude Code at a model server the user runs. Two
// API shapes: `openai` (OpenAI chat-completions, the common local shape —
// Ninfer, LM Studio, Ollama) and `anthropic` (the Anthropic messages API
// itself, reached directly). Claude Code speaks only the Anthropic shape, so
// an `openai` endpoint is addressed at equin's translator proxy, which turns
// its requests around (`claude-cli/llm-proxy`); an `anthropic` endpoint is
// addressed at itself.

/** The API shape an endpoint speaks. */
export const ENDPOINT_APIS = ["openai", "anthropic"] as const;
export type EndpointApi = (typeof ENDPOINT_APIS)[number];

/** The settings of one endpoint account, held in the accounts file. */
export const ClaudeEndpointSettingsSchema = z.object({
  /** The API shape the endpoint speaks; OpenAI-compatible by default. */
  api: z.enum(ENDPOINT_APIS).default("openai"),
  /**
   * The endpoint's base URL: for `openai`, the chat-completions root
   * (`http://host:port/v1` — the proxy appends `chat/completions`); for
   * `anthropic`, the messages-API root.
   */
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .refine(
      (s) => /^https?:\/\/\S+$/.test(s),
      "The base URL must be an http:// or https:// URL",
    ),
  /**
   * Which of the endpoint's own models serve the families: a launch's model
   * id runs as the map's name for its family, an unmapped family as the
   * Claude flag (a local server rejects it loudly). Absent: everything runs
   * as the Claude flag.
   */
  modelMap: ModelMapSchema.optional(),
  /**
   * The endpoint's model's real context window, in tokens. Claude Code
   * believes a model it does not know has a 1M-token window, so it never
   * auto-compacts before a local server with a smaller window (observed:
   * Ninfer's 262,144) refuses the request — and a conversation past that
   * limit cannot even compact itself. When set, it reaches Claude Code as
   * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (the knob its own unknown-model notice
   * names), and auto-compact fires before the server's hard limit. Absent:
   * the proxy still shapes the refusal so Claude Code's own prompt-too-long
   * rescue can recover.
   */
  contextWindow: z.number().int().positive().optional(),
});
export type ClaudeEndpointSettings = z.infer<
  typeof ClaudeEndpointSettingsSchema
>;

/** An added account holding an Anthropic API key — billed per use, no plan limits. */
export const ClaudeApiKeyAccountSchema = z.object({
  id: z.string().min(1),
  /** The user's name for it: "Work", "Personal". */
  name: z.string().min(1),
  /** When it was added, epoch milliseconds. */
  addedAt: z.number().int().positive(),
  kind: z.literal("api-key"),
});
/** An added account pointing at a local model endpoint. */
export const ClaudeEndpointAccountSchema = ClaudeApiKeyAccountSchema.omit({
  kind: true,
}).extend({
  kind: z.literal("endpoint"),
  endpoint: ClaudeEndpointSettingsSchema,
});

/** An added account: an API key, or a local model endpoint. */
export const ClaudeAccountSchema = z.discriminatedUnion("kind", [
  ClaudeApiKeyAccountSchema,
  ClaudeEndpointAccountSchema,
]);
export type ClaudeAccount = z.infer<typeof ClaudeAccountSchema>;
export type ClaudeApiKeyAccount = z.infer<typeof ClaudeApiKeyAccountSchema>;
export type ClaudeEndpointAccount = z.infer<typeof ClaudeEndpointAccountSchema>;

/**
 * The credential an agent on an added account signs in with, read at the
 * agent's start (`claudeAccountCredential`): the API key, or the endpoint's
 * settings with its bearer token (`null` when the endpoint takes no auth).
 * `null` itself is the system account — Claude Code's own login.
 */
export type ClaudeAccountCredential =
  | { kind: "api-key"; key: string }
  | {
      kind: "endpoint";
      /** The account id: the OpenAI endpoint is addressed at the proxy's path for it. */
      id: string;
      api: EndpointApi;
      baseUrl: string;
      token: string | null;
      modelMap?: ModelMap;
      contextWindow?: number;
    };

/**
 * Claude Code's environment for an endpoint account: `base` without any
 * credential variable, plus the base URL an endpoint is reached at — its own
 * for `anthropic`, the local translator proxy for `openai` — and its bearer
 * token when it has one (a tokenless endpoint sets no auth variable; the
 * endpoint's own refusal, if it has one, is the test's to surface). A mapped
 * `haiku` also becomes the small fast model, so Claude Code's background
 * calls (titles, summaries) do not send a Claude model name the endpoint
 * cannot serve. The declared context window, when the account has one, rides
 * as `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (see the setting's own doc).
 */
export function claudeEndpointEnv(
  base: Readonly<Record<string, string | undefined>>,
  credential: Extract<ClaudeAccountCredential, { kind: "endpoint" }>,
): Record<string, string | undefined> {
  const env = { ...base };
  for (const name of CLAUDE_CREDENTIAL_ENVS) delete env[name];
  env.ANTHROPIC_BASE_URL =
    credential.api === "openai"
      ? llmProxyUrl(credential.id)
      : credential.baseUrl;
  // Always set: with no auth variable at all Claude Code declines the turn
  // ("Not logged in · Please run /login") — it checks its own login before it
  // ever reaches the base URL. A tokenless endpoint rides a placeholder the
  // server never sees: the `openai` half's proxy decides the upstream auth
  // from the secrets store, and an `anthropic` endpoint that wants a token
  // refuses the placeholder with its own 401 — which is the truth.
  env.ANTHROPIC_AUTH_TOKEN = credential.token ?? "equin-local";
  if (credential.modelMap?.haiku !== undefined)
    env.ANTHROPIC_SMALL_FAST_MODEL = credential.modelMap.haiku;
  // Local model servers have no SLA, and their time-to-first-byte grows with
  // the full agent context: a 27B model prefilling a 30k-token prompt can take
  // a minute or more before its first streamed byte. Claude Code's default
  // first-byte patience (~12 s) KILLS such a request and retries — and every
  // retry re-prefills the whole prompt, so a slow endpoint burns its GPU on
  // the same prefill again and again. (Observed 2026-11-21, Ninfer/Qwen3.8-27b:
  // nine straight attempts died at 12.00 s; the one that landed took 44 s.)
  // Endpoints get generous ceilings instead — upper bounds that never bite on
  // a healthy server (its first byte is what it is), which let a slow prefill
  // run to completion. API accounts keep Claude Code's own defaults: Anthropic
  // answers in ~1 s, and short deadlines there surface a real outage faster.
  env.CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS = "300000"; // first byte: 5 min
  env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = "120000"; // gap between bytes: 2 min
  env.API_TIMEOUT_MS = "600000"; // whole request: 10 min
  // The model's real context window, when the account declares one. Claude
  // Code believes a model it does not know has a 1M-token window, so it never
  // auto-compacts before a local server with a smaller window refuses the
  // request — the conversation then cannot even compact itself. Telling it
  // the true window makes auto-compact fire before the hard limit. This is
  // the exact variable Claude Code's own unknown-model notice points at; an
  // inherited value is stripped first, so an endpoint that does not declare
  // one is never capped by a stray variable.
  delete env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  if (credential.contextWindow !== undefined)
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(credential.contextWindow);
  return env;
}

/**
 * Claude Code's environment for a credential: the API key's, the endpoint's,
 * or — `null`, the system account — `base` alone (the computer's own login).
 */
export function claudeAccountEnv(
  base: Readonly<Record<string, string | undefined>>,
  credential: ClaudeAccountCredential | null,
): Record<string, string | undefined> {
  if (credential === null) return { ...base };
  if (credential.kind === "api-key")
    return claudeCredentialEnv(base, credential.key);
  return claudeEndpointEnv(base, credential);
}

export const ClaudeAccountsSchema = z.object({
  /** The added accounts, in the order they were added. */
  accounts: wholeList(ClaudeAccountSchema, {
    reason: "the Claude accounts the user added by hand — a handful",
  }),
  /** The account new agents launch on: {@link SYSTEM_ACCOUNT_ID} or an added account's id. */
  active: z.string().min(1),
});
export type ClaudeAccounts = z.infer<typeof ClaudeAccountsSchema>;

/** Nothing added yet: the system account alone. */
export const NO_CLAUDE_ACCOUNTS: ClaudeAccounts = {
  accounts: [],
  active: SYSTEM_ACCOUNT_ID,
};

/** Every account id: the system one first, then the added accounts. */
export function claudeAccountIds(state: ClaudeAccounts): string[] {
  return [SYSTEM_ACCOUNT_ID, ...state.accounts.map((a) => a.id)];
}

/** The accounts and the active one, pushed whenever they change. */
export const claudeAccounts = liveValue("claude-accounts", {
  schema: ClaudeAccountsSchema,
  needsMachine: { feature: "Switching Claude accounts" },
});

// What the endpoints take: the optional token is an empty string when the
// endpoint takes no auth — normalised to `undefined` here so the body carries
// one shape.
const TokenField = z
  .union([z.literal(""), z.string().trim().min(1)])
  .optional();

export const addClaudeAccount = defineEndpoint({
  route: "POST /api/claude-accounts/add",
  body: z.object({
    name: z.string().trim().min(1),
    credential: ClaudeCredentialSchema,
  }),
  response: ClaudeAccountSchema,
  needsMachine: { feature: "Switching Claude accounts" },
});

/** Add an endpoint account: the settings plus the optional token. The machine half tests the endpoint (one turn) before anything is stored. */
export const addClaudeEndpoint = defineEndpoint({
  route: "POST /api/claude-accounts/add-endpoint",
  body: z.object({
    name: z.string().trim().min(1),
    endpoint: ClaudeEndpointSettingsSchema,
    token: TokenField,
  }),
  response: ClaudeAccountSchema,
  needsMachine: { feature: "Switching Claude accounts" },
});

/** Test an endpoint without saving it: one turn on a temporary account, answered with its reply and the models it offers. */
export const testClaudeEndpoint = defineEndpoint({
  route: "POST /api/claude-accounts/test",
  body: z.object({
    endpoint: ClaudeEndpointSettingsSchema,
    token: TokenField,
  }),
  response: z.object({
    /** The endpoint's reply to the test turn. */
    reply: z.string(),
    /** The models the endpoint offers (its `/v1/models`), best effort. */
    models: z.array(z.string()).optional(),
  }),
  needsMachine: { feature: "Switching Claude accounts" },
});

export const removeClaudeAccount = defineEndpoint({
  route: "POST /api/claude-accounts/remove",
  body: z.object({ id: z.string().min(1) }),
  needsMachine: { feature: "Switching Claude accounts" },
});

/**
 * Update an existing endpoint account in place (no destroy/recreate): the
 * whole settings plus the new name. The token, when given, replaces the
 * stored one — an endpoint that takes no auth omits it, and the stored
 * token (if any) is kept. The machine half runs the same live test `add-endpoint`
 * runs when the connection identity (API shape, base URL, model map, token)
 * changes — a broken edit must not brick the account — and persists a
 * name / context-window-only change directly.
 */
export const updateClaudeEndpoint = defineEndpoint({
  route: "POST /api/claude-accounts/update-endpoint",
  body: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    endpoint: ClaudeEndpointSettingsSchema,
    /** The new bearer token; absent keeps the stored one. */
    token: z.string().trim().min(1).optional(),
  }),
  response: ClaudeAccountSchema,
  needsMachine: { feature: "Switching Claude accounts" },
});

export const selectClaudeAccount = defineEndpoint({
  route: "POST /api/claude-accounts/select",
  body: z.object({ id: z.string().min(1) }),
  needsMachine: { feature: "Switching Claude accounts" },
});
