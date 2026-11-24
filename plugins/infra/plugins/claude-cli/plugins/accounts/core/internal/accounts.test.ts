import { describe, expect, test } from "bun:test";
import {
  ClaudeCredentialSchema,
  claudeCredentialEnv,
  claudeEndpointEnv,
  ClaudeEndpointSettingsSchema,
  type ClaudeAccountCredential,
} from "./accounts";
import { llmProxyUrl } from "./llm-proxy-address";

const TOKEN = `sk-ant-oat01-${"a".repeat(40)}`;
const KEY = `sk-ant-api03-${"b".repeat(40)}`;
const USER_KEY = `sk-ant-usr-${"d".repeat(40)}`;

describe("credentials", () => {
  test("an API key is accepted; a plan token or anything else is refused", () => {
    expect(ClaudeCredentialSchema.safeParse(KEY).success).toBe(true);
    expect(ClaudeCredentialSchema.safeParse(USER_KEY).success).toBe(true);
    expect(ClaudeCredentialSchema.safeParse(` ${KEY} `).success).toBe(true);
    expect(ClaudeCredentialSchema.safeParse(TOKEN).success).toBe(false);
    expect(
      ClaudeCredentialSchema.safeParse(`sk-ant-admin01-${"c".repeat(40)}`)
        .success,
    ).toBe(false);
  });

  test("the env carries the API key and no other credential", () => {
    const base = { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "stale" };
    expect(claudeCredentialEnv(base, KEY)).toEqual({
      PATH: "/bin",
      ANTHROPIC_API_KEY: KEY,
    });
    expect(
      claudeCredentialEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "stale" }, KEY),
    ).toEqual({ PATH: "/bin", ANTHROPIC_API_KEY: KEY });
  });
});

describe("endpoint env", () => {
  const openai: ClaudeAccountCredential = {
    kind: "endpoint",
    id: "acct-local",
    api: "openai",
    baseUrl: "http://100.99.219.116:8080/v1",
    token: null,
  };
  const anthropic: ClaudeAccountCredential = {
    ...openai,
    api: "anthropic",
    token: "sekrit",
  };

  test("an openai endpoint is reached at the proxy, with the local timeout ceilings", () => {
    expect(claudeEndpointEnv({ PATH: "/bin" }, openai)).toEqual({
      PATH: "/bin",
      ANTHROPIC_BASE_URL: llmProxyUrl("acct-local"),
      ANTHROPIC_AUTH_TOKEN: "muxos-local",
      CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: "300000",
      CLAUDE_STREAM_IDLE_TIMEOUT_MS: "120000",
      API_TIMEOUT_MS: "600000",
    });
  });

  test("an anthropic endpoint is reached at itself, with its token", () => {
    expect(
      claudeEndpointEnv({ PATH: "/bin" }, anthropic).ANTHROPIC_BASE_URL,
    ).toBe("http://100.99.219.116:8080/v1");
    expect(
      claudeEndpointEnv({ PATH: "/bin" }, anthropic).ANTHROPIC_AUTH_TOKEN,
    ).toBe("sekrit");
  });

  test("a mapped haiku becomes the small fast model", () => {
    expect(
      claudeEndpointEnv({}, { ...openai, modelMap: { haiku: "qwen3-4b" } })
        .ANTHROPIC_SMALL_FAST_MODEL,
    ).toBe("qwen3-4b");
  });

  test("the declared context window reaches Claude Code as CLAUDE_CODE_MAX_CONTEXT_TOKENS", () => {
    expect(
      claudeEndpointEnv({}, { ...openai, contextWindow: 262144 })
        .CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    ).toBe("262144");
  });

  test("an undeclared window sets no variable — not even a stale one inherited from the base", () => {
    const env = claudeEndpointEnv(
      { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "999", ANTHROPIC_BASE_URL: "stale" },
      openai,
    );
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe(llmProxyUrl("acct-local"));
  });

  test("the context window is an optional positive integer", () => {
    expect(
      ClaudeEndpointSettingsSchema.parse({
        baseUrl: "http://x:1/v1",
        contextWindow: 262144,
      }).contextWindow,
    ).toBe(262144);
    expect(
      ClaudeEndpointSettingsSchema.parse({
        baseUrl: "http://x:1/v1",
      }).contextWindow,
    ).toBeUndefined();
    expect(
      ClaudeEndpointSettingsSchema.safeParse({
        baseUrl: "http://x:1/v1",
        contextWindow: 0,
      }).success,
    ).toBe(false);
    expect(
      ClaudeEndpointSettingsSchema.safeParse({
        baseUrl: "http://x:1/v1",
        contextWindow: 12.5,
      }).success,
    ).toBe(false);
  });
});
