import { afterAll, describe, expect, test } from "bun:test";
import { CLI_NAMES } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../context";
import type { Verdict } from "../types";
import { backgroundOpsGuard } from "./background-ops";

function verdict(command: string, run_in_background?: boolean): Verdict {
  return backgroundOpsGuard.check(
    { command, run_in_background },
    createContext("/tmp"),
  ) as Verdict;
}

/**
 * The same call as `verdict`, but made by a subagent. A real session id per
 * call, because the guard records the started op under it — sharing one would
 * let these tests write over each other's ledger.
 */
const scratch: string[] = [];
function subagentVerdict(
  command: string,
  run_in_background?: boolean,
): Verdict {
  const cwd = mkdtempSync(join(tmpdir(), "bg-ops-"));
  const sessionId = `bg-ops-test-${scratch.length}-${process.pid}`;
  scratch.push(cwd, join(tmpdir(), `guard-agent-ops-${sessionId}.json`));
  return backgroundOpsGuard.check(
    { command, run_in_background },
    createContext(cwd, sessionId, [], undefined, {
      id: "agent-1",
      type: "general-purpose",
    }),
  ) as Verdict;
}

// The guard records the started op under its session id. Left behind, those
// files accumulate in the host's temp dir on every test run.
afterAll(() => {
  for (const path of scratch) rmSync(path, { force: true, recursive: true });
});

const blocks = (command: string, bg?: boolean) =>
  verdict(command, bg).kind === "deny";
const rewrites = (command: string) => verdict(command).kind === "rewrite";
const reason = (command: string, bg?: boolean) => {
  const v = verdict(command, bg);
  return v.kind === "deny" ? v.reason : "";
};

describe("background-ops guard", () => {
  describe("a foreground build/push that is the whole command is backgrounded", () => {
    for (const op of ["build", "push"]) {
      for (const cli of CLI_NAMES.map((n) => `./${n}`)) {
        test(`${cli} ${op}`, () => {
          const v = verdict(`${cli} ${op}`);
          expect(v.kind).toBe("rewrite");
          expect(v.kind === "rewrite" && v.patch).toEqual({
            run_in_background: true,
          });
        });
      }
    }

    test("with its flags and a 2>&1", () => {
      expect(rewrites(`./muxos build --skip-checks 2>&1`)).toBe(true);
      expect(rewrites(`./muxos push -m "fix(x): y" --fixes-report r-1`)).toBe(
        true,
      );
    });

    test("behind a cd into the checkout, and/or into a tail of its output", () => {
      // The 36 of 78 refused calls the audit found (2026-11-14): these shapes.
      for (const cmd of [
        "cd /r/repo/.claude/worktrees/att-1 && ./muxos build",
        "cd /r/repo/.claude/worktrees/att-1; ./muxos build",
        "./muxos push -m x 2>&1 | tail -15",
        "./muxos build 2>&1 | tail -n 40",
        "cd /r/wt && ./muxos push -m x 2>&1 | tail -15",
      ])
        expect(rewrites(cmd)).toBe(true);
    });

    test("a push whose message is the heredoc idiom", () => {
      const cmd = [
        "./muxos push -m \"$(cat <<'EOF'",
        "fix(x): a thing",
        "",
        "Co-Authored-By: someone",
        "EOF",
        ')"',
      ].join("\n");
      expect(rewrites(cmd)).toBe(true);
      expect(rewrites(`cd /r/wt; ${cmd} 2>&1 | tail -15`)).toBe(true);
    });

    test("the main conversation is told what happened and to end its turn", () => {
      const v = verdict("./muxos build");
      expect(v.kind === "rewrite" && v.note).toContain(
        "run_in_background: true",
      );
      expect(v.kind === "rewrite" && v.note).toContain("END YOUR TURN");
    });

    test("a subagent is told to await instead, and its op is recorded", () => {
      const v = subagentVerdict("./muxos push -m x");
      expect(v.kind).toBe("rewrite");
      expect(v.kind === "rewrite" && v.note).toContain("./muxos await push");
      expect(v.kind === "rewrite" && v.note).not.toContain("END YOUR TURN");
    });
  });

  describe("forms a background run would read differently stay refused", () => {
    for (const cmd of [
      "time ./muxos build 2>&1 | tail -15; git status",
      "./muxos build | head -30",
      "./muxos build | tail -f",
      "./muxos build | tail -15 | grep x",
      "./muxos build | tail -15; git status",
      "git status --short && ./muxos push -m x 2>&1 | tail -15",
      "cd /r/wt && git status && ./muxos push -m x",
      'cd "$WT" && ./muxos build',
      "cd /r/wt && ./muxos build && echo ok",
      "./muxos build; git status",
      "./muxos build && echo done",
      "git fetch && ./muxos push -m x",
      "time ./muxos build",
      "FOO=1 ./muxos build",
      "./muxos build > build.log",
      "(./muxos build)",
      './muxos push -m "$(git log -1 --format=%s)"',
      "./muxos release",
    ]) {
      test(cmd, () => {
        expect(verdict(cmd).kind).toBe("deny");
      });
    }

    test("the exact shape from conv-1786116592-b70n, with a time wrapper", () => {
      expect(
        blocks(
          `time ./muxos push -m "feat(data-view): properties" 2>&1 | tail -50`,
        ),
      ).toBe(true);
    });

    test("behind a cd and another command, as agents often write it", () => {
      expect(
        blocks(
          // Fake root, deliberately not under /Users — see `paths:no-hardcoded-paths`.
          `cd /r/repo/.claude/worktrees/att-1 && git status --short; ./muxos build`,
        ),
      ).toBe(true);
    });

    test("hidden inside a loop body — the parseShell blind spot", () => {
      expect(blocks(`until false; do ./muxos build; done`)).toBe(true);
    });

    test("the denial names run_in_background", () => {
      expect(reason("./muxos build | head -5")).toContain("run_in_background");
    });
  });

  describe("backgrounded long ops are allowed", () => {
    test("build with the flag", () => {
      expect(blocks("./muxos build", true)).toBe(false);
    });

    test("push with the flag and a pipe", () => {
      expect(blocks(`./muxos push -m "x" 2>&1 | tail -50`, true)).toBe(false);
    });
  });

  describe("shell-level detach is not backgrounding", () => {
    test("trailing & in the foreground", () => {
      expect(blocks("./muxos build &")).toBe(true);
    });

    test("nohup", () => {
      expect(blocks("nohup ./muxos build")).toBe(true);
    });

    test("trailing & even WITH run_in_background, because it fakes completion", () => {
      expect(blocks("./muxos build &", true)).toBe(true);
    });

    test("2>&1 is a redirection, not a detach", () => {
      expect(blocks("./muxos build 2>&1", true)).toBe(false);
    });
  });

  describe("a subagent is told to await, because nothing will wake it", () => {
    test("a backgrounded op is still allowed — the op itself is fine", () => {
      const v = subagentVerdict("./muxos build", true);
      expect(v.kind).not.toBe("deny");
    });

    test("… but it is told to await instead of ending its turn", () => {
      const v = subagentVerdict("./muxos build", true);
      expect(v.kind).toBe("inform");
      expect(v.kind === "inform" && v.context).toContain("./muxos await build");
      expect(v.kind === "inform" && v.context).toContain("NOT reach you");
    });

    test("the main conversation is told nothing new — its notification works", () => {
      expect(verdict("./muxos build", true).kind).toBe("allow");
    });

    test("a foreground op still denies, but the hint names both steps", () => {
      const v = subagentVerdict("./muxos build | head -5");
      expect(v.kind).toBe("deny");
      expect(v.kind === "deny" && v.reason).toContain("run_in_background");
      expect(v.kind === "deny" && v.reason).toContain("./muxos await build");
    });

    test("the main conversation's foreground hint still says to end its turn", () => {
      const v = verdict("./muxos build | head -5");
      expect(v.kind === "deny" && v.reason).toContain("END YOUR TURN");
    });

    test("a subagent's foreground hand-off op goes through", () => {
      expect(subagentVerdict("./muxos test plugins/x").kind).toBe("allow");
    });

    test("a subagent detaching with & is denied like anyone else", () => {
      expect(subagentVerdict("./muxos build &", true).kind).toBe("deny");
    });

    test("a command that is not a long op says nothing to a subagent either", () => {
      expect(subagentVerdict("ls -la", true).kind).toBe("allow");
    });
  });

  describe("documents are written, not run", () => {
    const S = "./muxos";

    test("the repro: a research doc mentioning the build in inline code", () => {
      const cmd = [
        "cat > research/x.md <<'EOF'",
        "## Verification",
        "",
        "- `" + S + " build --composition sonata` from an agent worktree",
        "- `" + S + " build` with no flag is byte-equivalent",
        "EOF",
      ].join("\n");
      expect(blocks(cmd)).toBe(false);
    });

    test("… and in a fenced code block", () => {
      const cmd = [
        "cat > doc.md <<'EOF'",
        "```bash",
        S + " build",
        "```",
        "EOF",
      ].join("\n");
      expect(blocks(cmd)).toBe(false);
    });

    test("a script whose body ends in & is not a detach", () => {
      const cmd = ["cat > s.sh <<'EOF'", S + " build &", "EOF"].join("\n");
      expect(blocks(cmd)).toBe(false);
    });

    test("a commit message body is data, but the push it decorates is not", () => {
      const cmd = [
        S + " push -m \"$(cat <<'EOF'",
        "fix(x): a thing",
        "",
        "Ran `" + S + " build` first",
        "EOF",
        ')"',
      ].join("\n");
      expect(rewrites(cmd)).toBe(true);
      expect(blocks(cmd, true)).toBe(false);
    });

    test("… including when the message body holds an unpaired quote", () => {
      const cmd = [
        S + " push -m \"$(cat <<'EOF'",
        'He said "hi and ran `' + S + " build` then",
        "EOF",
        ')"',
      ].join("\n");
      expect(rewrites(cmd)).toBe(true);
      expect(blocks(cmd, true)).toBe(false);
    });

    test("the scanner resumes after a terminator", () => {
      const cmd = ["python3 - <<'PY'", "print(1)", "PY", S + " build"].join(
        "\n",
      );
      expect(blocks(cmd)).toBe(true);
    });

    test("a body piped into a shell really runs", () => {
      const cmd = ["cat <<'EOF' | bash", S + " build", "EOF"].join("\n");
      expect(blocks(cmd)).toBe(true);
    });
  });

  describe("ops that hand off at the call's deadline run in the foreground", () => {
    for (const op of ["check", "test"]) {
      for (const cli of CLI_NAMES.map((n) => `./${n}`)) {
        test(`${cli} ${op}`, () => {
          expect(blocks(`${cli} ${op}`)).toBe(false);
        });
      }
    }

    test("alongside other commands in one call", () => {
      expect(blocks("./muxos format && ./muxos check type-check")).toBe(false);
    });

    test("… but a chain with an op that cannot hand off is held back", () => {
      const r = reason("./muxos check && ./muxos build");
      expect(r).toContain("./muxos build");
      expect(r).toContain("run_in_background");
    });

    test("a shell detach is still refused", () => {
      expect(blocks("./muxos test &")).toBe(true);
    });
  });

  describe("short commands stay allowed", () => {
    test("check --list", () => {
      expect(blocks("./muxos check --list")).toBe(false);
    });

    test("--help", () => {
      expect(blocks("./muxos build --help")).toBe(false);
    });

    test("an unrelated command", () => {
      expect(blocks("git status")).toBe(false);
    });

    test("a different binary named similarly", () => {
      expect(blocks("echo ./muxos build")).toBe(false);
    });
  });
});
