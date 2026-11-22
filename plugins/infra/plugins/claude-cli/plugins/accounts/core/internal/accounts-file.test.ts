import { describe, expect, test } from "bun:test";
import { ClaudeEndpointSettingsSchema, type ClaudeAccounts } from "./accounts";
import { accountsFileOf, parseAccountsFile } from "./accounts-file";

const key = {
  id: "acct-key",
  name: "API credit",
  addedAt: 2,
  kind: "api-key" as const,
};
const endpointSettings = ClaudeEndpointSettingsSchema.parse({
  baseUrl: "http://100.99.219.116:8080/v1",
});
const endpoint = {
  id: "acct-local",
  name: "Ninfer",
  addedAt: 3,
  kind: "endpoint" as const,
  endpoint: {
    ...endpointSettings,
    modelMap: { sonnet: "qwen3.8-27b" },
  },
};

describe("parseAccountsFile", () => {
  test("a file written since reads back as written", () => {
    const state: ClaudeAccounts = {
      accounts: [key, endpoint],
      active: "acct-local",
    };
    expect(parseAccountsFile(accountsFileOf(state))).toEqual({
      state,
      planAccounts: [],
    });
  });

  test("an older file's plan accounts are never run on", () => {
    const file = {
      accounts: [
        { id: "acct-plan", name: "Work", addedAt: 1, kind: "token" },
        { ...key },
        { id: "acct-nokind", name: "Old", addedAt: 2 },
      ],
      active: "acct-key",
      autoSwitch: true,
    };
    expect(parseAccountsFile(file)).toEqual({
      state: { accounts: [key], active: "acct-key" },
      planAccounts: ["acct-plan", "acct-nokind"],
    });
  });

  test("an active plan account falls back to the computer's own login", () => {
    // Written before API keys existed: no kind, every account a plan token.
    const file = {
      accounts: [{ id: "acct-plan", name: "Work", addedAt: 1 }],
      active: "acct-plan",
    };
    expect(parseAccountsFile(file)).toEqual({
      state: { accounts: [], active: "system" },
      planAccounts: ["acct-plan"],
    });
  });

  test("a temporary test row parses like any endpoint row", () => {
    const file = {
      accounts: [{ ...endpoint, id: "test-abcd1234", name: "test" }],
      active: "system",
    };
    const parsed = parseAccountsFile(file);
    expect(parsed.state.accounts).toEqual([
      { ...endpoint, id: "test-abcd1234", name: "test" },
    ]);
    expect(parsed.planAccounts).toEqual([]);
  });

  test("an endpoint row without its settings is corruption and throws", () => {
    const file = {
      accounts: [{ id: "acct-x", name: "X", addedAt: 1, kind: "endpoint" }],
      active: "system",
    };
    expect(() => parseAccountsFile(file)).toThrow();
  });
});
