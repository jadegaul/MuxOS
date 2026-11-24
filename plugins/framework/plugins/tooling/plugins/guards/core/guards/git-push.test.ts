import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../context";
import type { Verdict } from "../types";
import { gitPushGuard } from "./git-push";

const root = mkdtempSync(join(tmpdir(), "git-push-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// An muxos checkout: a `.git` FILE (as in a worktree) plus the CLI.
const muxosRepo = join(root, "muxos-wt");
mkdirSync(join(muxosRepo, "plugins/framework/plugins/cli/bin"), {
  recursive: true,
});
mkdirSync(join(muxosRepo, "src/deep"), { recursive: true });
writeFileSync(join(muxosRepo, ".git"), "gitdir: elsewhere\n");
writeFileSync(join(muxosRepo, "muxos"), "#!/bin/sh\n");
writeFileSync(
  join(muxosRepo, "plugins/framework/plugins/cli/bin/index.ts"),
  "",
);

// Some other repository.
const other = join(root, "pg-client-embedded");
mkdirSync(join(other, ".git"), { recursive: true });
mkdirSync(join(other, "src"), { recursive: true });

const notARepo = join(root, "plain");
mkdirSync(notARepo);

const blocks = (command: string, cwd: string) =>
  (gitPushGuard.check({ command }, createContext(cwd)) as Verdict).kind ===
  "deny";

describe("git-push guard targets only muxos checkouts", () => {
  test("blocks a push from an muxos checkout", () => {
    expect(blocks("git push origin main", muxosRepo)).toBe(true);
  });

  test("blocks from a subdirectory of an muxos checkout", () => {
    expect(blocks("git push", join(muxosRepo, "src/deep"))).toBe(true);
  });

  test("allows a push from another repo", () => {
    expect(blocks("git push -u origin main", other)).toBe(false);
    expect(blocks("git push", join(other, "src"))).toBe(false);
  });

  test("follows cd into another repo", () => {
    expect(blocks(`cd ${other} && git push`, muxosRepo)).toBe(false);
  });

  test("follows cd into an muxos checkout", () => {
    expect(blocks(`cd ${muxosRepo} && git push`, other)).toBe(true);
  });

  test("follows -C, relative to the call's cwd", () => {
    expect(blocks(`git -C ${other} push`, muxosRepo)).toBe(false);
    expect(blocks("git -C ../muxos-wt push", other)).toBe(true);
    expect(blocks(`git -c a.b=c -C ${muxosRepo} push`, other)).toBe(true);
  });

  test("an muxos push later in the chain is still caught", () => {
    expect(blocks(`git push; git -C ${muxosRepo} push`, other)).toBe(true);
  });

  test("an unfollowed repository spelling is treated as muxos", () => {
    expect(blocks(`git --git-dir=${other}/.git push`, other)).toBe(true);
    expect(blocks("GIT_DIR=.git git push", other)).toBe(true);
  });

  test("a directory that is no repo is treated as muxos", () => {
    expect(blocks("git push", notARepo)).toBe(true);
  });

  test("other git subcommands are untouched", () => {
    expect(blocks("git -C . status", muxosRepo)).toBe(false);
  });
});
