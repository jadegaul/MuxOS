import { describe, expect, test } from "bun:test";
import { connectionIdentityChanged } from "./routes";

const base = {
  api: "openai" as const,
  baseUrl: "http://100.99.219.116:8080/v1",
  modelMap: { sonnet: "qwen3.8-27b" },
};

describe("connectionIdentityChanged", () => {
  test("a context-window or name-only nudge changes nothing of the connection", () => {
    expect(
      connectionIdentityChanged(
        base,
        { ...base, contextWindow: 262144 },
        null,
        null,
      ),
    ).toBe(false);
  });

  test("an unchanged settings-and-token pair is not a change", () => {
    expect(
      connectionIdentityChanged(
        base,
        { ...base, modelMap: { sonnet: "qwen3.8-27b" } },
        "tok",
        "tok",
      ),
    ).toBe(false);
  });

  test("each connection piece alone is a change", () => {
    expect(
      connectionIdentityChanged(
        base,
        { ...base, api: "anthropic" },
        null,
        null,
      ),
    ).toBe(true);
    expect(
      connectionIdentityChanged(
        base,
        { ...base, baseUrl: "http://100.99.219.116:9090/v1" },
        null,
        null,
      ),
    ).toBe(true);
    expect(
      connectionIdentityChanged(
        base,
        { ...base, modelMap: { sonnet: "qwen3.8-32b" } },
        null,
        null,
      ),
    ).toBe(true);
    expect(connectionIdentityChanged(base, base, "tok", "other")).toBe(true);
  });

  test("the model map compares by content, key order aside", () => {
    expect(
      connectionIdentityChanged(
        { ...base, modelMap: { haiku: "qwen3-4b", sonnet: "qwen3.8-27b" } },
        { ...base, modelMap: { sonnet: "qwen3.8-27b", haiku: "qwen3-4b" } },
        null,
        null,
      ),
    ).toBe(false);
    expect(
      connectionIdentityChanged(
        { ...base, modelMap: { haiku: "qwen3-4b", sonnet: "qwen3.8-27b" } },
        { ...base, modelMap: { sonnet: "qwen3.8-27b" } },
        null,
        null,
      ),
    ).toBe(true);
  });

  test("adding or dropping a token is a change either way", () => {
    expect(connectionIdentityChanged(base, base, null, "tok")).toBe(true);
    expect(connectionIdentityChanged(base, base, "tok", null)).toBe(true);
  });
});
