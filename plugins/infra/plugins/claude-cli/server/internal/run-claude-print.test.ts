import { describe, expect, test } from "bun:test";
import {
  ENDPOINT_ONE_SHOT_TIMEOUT_MS,
  oneShotTimeoutMs,
} from "./run-claude-print";

describe("oneShotTimeoutMs — the bound a one-shot call runs under", () => {
  test("an endpoint account's call is widened to the endpoint bound", () => {
    expect(oneShotTimeoutMs(30_000, true)).toBe(ENDPOINT_ONE_SHOT_TIMEOUT_MS);
    expect(oneShotTimeoutMs(15_000, true)).toBe(ENDPOINT_ONE_SHOT_TIMEOUT_MS);
  });

  test("a caller that asked for MORE keeps its own bound", () => {
    expect(oneShotTimeoutMs(ENDPOINT_ONE_SHOT_TIMEOUT_MS + 60_000, true)).toBe(
      ENDPOINT_ONE_SHOT_TIMEOUT_MS + 60_000,
    );
  });

  test("a key or system account's bound is never touched", () => {
    expect(oneShotTimeoutMs(30_000, false)).toBe(30_000);
    expect(oneShotTimeoutMs(12_000, false)).toBe(12_000);
  });

  test("the endpoint bound itself is a multiple of the caller bounds it replaces", () => {
    // The one-shot callers ask for 12–30 s; the endpoint bound must be
    // comfortably past their tail (a local model took 15–30 s on a title).
    expect(ENDPOINT_ONE_SHOT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
