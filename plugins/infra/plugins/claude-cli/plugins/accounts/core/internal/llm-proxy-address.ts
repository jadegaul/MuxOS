/**
 * Where an `openai` endpoint account is reached from: muxos's local LLM
 * translator proxy (`claude-cli/llm-proxy`) — one process per machine, bound
 * to loopback, serving one path per endpoint account. The address is part of
 * the endpoint credential's contract (what its ANTHROPIC_BASE_URL is), so it
 * lives with the accounts, not with the plugin that runs the proxy.
 */

/** The port the translator proxy binds, on loopback. */
export const LLM_PROXY_PORT = 8800;

/**
 * The base URL an agent's Claude Code addresses for `accountId`: the account's
 * root. Claude Code appends its own `/v1/…` paths (messages, models) to the
 * base — so this must NOT end in `/v1`, or every call lands on `/v1/v1/…` and
 * 404s (a 404 Claude Code reads as "the model does not exist"). The proxy
 * serves those paths under it (`/p/<id>/v1/messages`, `/p/<id>/v1/models`).
 */
export function llmProxyUrl(accountId: string): string {
  return `http://127.0.0.1:${LLM_PROXY_PORT}/p/${encodeURIComponent(accountId)}`;
}
