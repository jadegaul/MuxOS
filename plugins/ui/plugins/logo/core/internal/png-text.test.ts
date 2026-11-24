import { expect, test } from "bun:test";
import { hasPngText, withPngText } from "./png-text";

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

test("a stamped PNG carries its text, readable from a lossy text decode", () => {
  const stamped = withPngText(PNG, "muxos-logo-source", "abc123");
  expect(stamped.length).toBe(
    PNG.length + 12 + "muxos-logo-source".length + 1 + 6,
  );
  const text = new TextDecoder().decode(stamped);
  expect(hasPngText(text, "muxos-logo-source", "abc123")).toBe(true);
  expect(hasPngText(text, "muxos-logo-source", "abc124")).toBe(false);
  expect(
    hasPngText(new TextDecoder().decode(PNG), "muxos-logo-source", "abc123"),
  ).toBe(false);
});

test("not a PNG is an error", () => {
  expect(() => withPngText(new Uint8Array(40), "k", "v")).toThrow("Not a PNG");
});
