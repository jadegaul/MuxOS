import { describe, expect, test } from "bun:test";
import { canParseUrl } from "./compat";

describe("canParseUrl", () => {
  test("answers as URL.canParse does", () => {
    const cases: [string, string | undefined][] = [
      ["https://MuxOS.app/a?b#c", undefined],
      ["/relative", undefined],
      ["/relative", "https://MuxOS.app"],
      ["not a url", undefined],
      ["", "https://MuxOS.app/x"],
      ["http://[::1", undefined],
      ["mailto:a@b.c", undefined],
    ];
    for (const [raw, base] of cases)
      expect(canParseUrl(raw, base)).toBe(URL.canParse(raw, base));
  });
});
