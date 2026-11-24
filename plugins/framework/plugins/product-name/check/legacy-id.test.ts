import { describe, expect, test } from "bun:test";
import { LEGACY_IDS } from "../core/internal/legacy-ids";
import { offendingLine, stripResearchRefs } from "./legacy-id";

// The old names, assembled so this file does not itself spell them.
const OLD = ["sing", "ularity"].join("");
const PREV = ["equ", "in"].join("");

describe("offendingLine", () => {
  test("flags the old name in any case: identifiers, scopes, keys, prose", () => {
    expect(offendingLine(`const ns = "${OLD}";`, [])).toBe(true);
    expect(
      offendingLine(
        `function is${OLD[0]!.toUpperCase()}${OLD.slice(1)}() {}`,
        [],
      ),
    ).toBe(true);
    expect(offendingLine(`"name": "@${OLD}/plugin-a"`, [])).toBe(true);
    expect(offendingLine(`// the ${OLD} data root`, [])).toBe(true);
  });

  test("an env var's old name is flagged, except in a mirror that spells the prefix", () => {
    const name = `${OLD.toUpperCase()}_DIR`;
    expect(offendingLine(`process.env.${name}`, [])).toBe(true);
    expect(
      offendingLine(`\${NEW_DIR:-$${name}}`, [`${OLD.toUpperCase()}_`]),
    ).toBe(false);
  });

  test("flags a repository URL under the old name", () => {
    expect(offendingLine(`https://github.com/Owner/${OLD}/pull/1`, [])).toBe(
      true,
    );
  });

  test("the legacy data dir is flagged outside the mirrors that spell it", () => {
    const dir = LEGACY_IDS.dataDirName;
    expect(offendingLine(`~/${dir}/worktrees/x`, [])).toBe(true);
    expect(offendingLine(`"$HOME/${dir}"`, [])).toBe(true);
    expect(offendingLine(`legacy="$HOME/${dir}"`, [dir])).toBe(false);
    expect(offendingLine(`label: "dev.${OLD}.gateway"`, [])).toBe(true);
  });

  test("a mirror may spell the values it declares, and only those", () => {
    const value = LEGACY_IDS.mergeMarkersDir;
    expect(offendingLine(`MARKERS="$GITDIR/${value}"`, [value])).toBe(false);
    expect(offendingLine(`# the ${OLD} hook`, [value])).toBe(true);
  });

  test("flags the previous generation's lowercase name: prose, identifiers, scopes", () => {
    expect(offendingLine(`const ns = "${PREV}";`, [])).toBe(true);
    expect(offendingLine(`// the ${PREV} data root`, [])).toBe(true);
    expect(offendingLine(`"name": "@${PREV}/plugin-a"`, [])).toBe(true);
  });

  test("an env var's previous-generation name is flagged, except in a mirror that spells the prefix", () => {
    const name = `${PREV.toUpperCase()}_DATA_ROOT_LAYOUT`;
    expect(offendingLine(`process.env.${name}`, [])).toBe(true);
    expect(offendingLine(`\${NEW:-$${name}}`, [`${PREV.toUpperCase()}_`])).toBe(
      false,
    );
  });

  test("the previous generation's kept ids are flagged, and its mirrors may spell them", () => {
    const alias = LEGACY_IDS.mainHostAlias;
    const dir = LEGACY_IDS.dataDirName;
    expect(offendingLine(`"$HOME/${dir}/worktrees/x"`, [])).toBe(true);
    expect(offendingLine(`"$HOME/${dir}/worktrees/x"`, [dir])).toBe(false);
    expect(offendingLine(`"${alias}": "singularity",`, [])).toBe(true);
    expect(offendingLine(`"${alias}": "singularity",`, [alias])).toBe(false);
  });

  test("a reference to a research doc's filename is history, not a live mention", () => {
    const ref = "research/2026-10-25-global-equin-env-vars.md";
    expect(offendingLine(`see ${ref} for the split`, [])).toBe(true);
    expect(
      offendingLine(stripResearchRefs(`see ${ref} for the split`), []),
    ).toBe(false);
  });
});
