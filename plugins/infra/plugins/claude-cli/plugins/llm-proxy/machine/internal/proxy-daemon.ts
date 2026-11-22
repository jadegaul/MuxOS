import { join } from "node:path";
import { asAppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  defineDaemon,
  pidAlive,
  readPidFile,
  type DaemonInstance,
} from "@plugins/infra/plugins/spawn/plugins/daemon/server";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";
import { isHostSingleton } from "@plugins/infra/plugins/paths/core";
import { PS } from "@plugins/infra/plugins/paths/server";
import { pickHostEnv } from "@plugins/infra/plugins/launcher/plugins/runtime-env/core";
import { acquireDirWatch } from "@plugins/infra/plugins/file-watcher/server";
import { MAIN_WORKTREE_NAME } from "@plugins/infra/plugins/namespace/core";
import { openOwnedFd } from "@plugins/packages/plugins/owned-fd/core";
import { readClaudeAccounts } from "@plugins/infra/plugins/claude-cli/plugins/accounts/machine";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { llmProxyLogsDir, llmProxyPidsDir } from "../../data-dirs";

// The proxy's process, one per machine: the host singleton's backend starts it
// detached (its own session and process group, so a backend restart or crash
// does not reach it) and follows it by its pid file — the file exists exactly
// while the process holds its loopback port (the proxy writes it once the bind
// succeeds, removes it as it exits). Every OTHER backend of the machine can
// only wait for it: the start outside `where: "host-singleton"` throws, and the
// write that makes it needed (an endpoint test's temporary row reaching the
// accounts file) already reached the singleton's watcher, which started it.

export const llmProxyDaemon = defineDaemon({
  name: "claude-cli.llm-proxy",
  description:
    "The local LLM translator proxy (bin/proxy.ts): one bun process on the machine, answering Claude Code's Anthropic messages calls at http://127.0.0.1:8800/p/<account> (Claude Code appends its own /v1/… paths — the base must not carry /v1) by turning them into the OpenAI chat-completions calls an endpoint account's server speaks (or passing an Anthropic endpoint through), started detached by the host singleton while any openai endpoint account exists.",
  startedBy: "on-demand",
  where: "host-singleton",
  restart: { kind: "never" },
});

/** The proxy script beside THIS code — the checkout serving its backend. */
const PROXY_SCRIPT = asAppPath(join(import.meta.dir, "../../bin/proxy.ts"));

const INSTANCE = "proxy";

/** This backend's record of the proxy it started or re-attached, when any. */
let instance: DaemonInstance | null = null;
/** What its last death said, for the wait that finds none up. */
let lastFailure: string | null = null;

export function proxyPidPath(): AppPath {
  return llmProxyPidsDir.file("proxy.pid");
}

export function proxyLogPath(): AppPath {
  return llmProxyLogsDir.file("proxy.log");
}

/**
 * Whether the proxy answers now: its pid file names a live process whose
 * command line carries this very pid file — a file a killed proxy left behind
 * can name a pid the system has since given to another process, which must
 * never count as it.
 */
export async function proxyAlive(): Promise<boolean> {
  const pidFile = proxyPidPath();
  const read = await readPidFile(pidFile);
  if (read.kind !== "pid" || !pidAlive(read.pid)) return false;
  // A wedge-breaker for the ps query, not a latency bound: it answers in
  // milliseconds, so only a wedged child reaches it.
  const ps = await spawnCaptured(
    [PS, "-ww", "-o", "command=", "-p", String(read.pid)],
    { timeoutMs: 30_000 },
  );
  // ps exits 1 when the pid is gone (it exited since the liveness check).
  if (ps.exitCode === 1 && !ps.timedOut) return false;
  if (ps.exitCode !== 0 || ps.timedOut) {
    throw new Error(
      `ps -p ${String(read.pid)} failed (${ps.timedOut ? "timed out" : String(ps.signalCode ?? ps.exitCode)}): ${ps.stderr.trim()}`,
    );
  }
  return ps.stdout.includes(String(pidFile));
}

/** Start the proxy process (the singleton's half of {@link ensureProxyUp}). */
async function launchProxy(): Promise<void> {
  const pidFile = proxyPidPath();
  await llmProxyPidsDir.ensure();
  // The log appends across incarnations: this launch's output starts here.
  const log = await openOwnedFd(proxyLogPath(), "a");
  try {
    instance = llmProxyDaemon.launchDetached({
      instance: INSTANCE,
      argv: [process.execPath, PROXY_SCRIPT, "--pid-file", String(pidFile)],
      // The host facts alone: a relay signs in as nothing (the process
      // strips its credential variables itself), and reads its data root
      // from the disk at its own start.
      env: pickHostEnv(process.env),
      pidFile,
      outputFd: log,
      onState: (t) => {
        if (t.state === "stopped") {
          lastFailure = t.state;
          return;
        }
        if (t.state === "exited" || t.state === "gave-up")
          lastFailure = t.lastError ?? t.state;
      },
    });
  } finally {
    log.close();
  }
}

/**
 * Wait for the proxy to answer — its pid file appearing (watched) — or the
 * deadline: the bounded wait both halves share, the singleton after its own
 * launch, the other backends after their write reached the singleton's
 * watcher. Throws, with what the launch said when it has a record.
 */
export async function waitForProxyUp(timeoutMs = 30_000): Promise<void> {
  if (await proxyAlive()) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  let settled = false;
  const settle = (): void => {
    if (!settled) {
      settled = true;
      resolve();
    }
  };
  const timer = setTimeout(settle, timeoutMs);
  // The directory exists before the watch: the launcher's ensure and this
  // wait can race on a machine where the proxy has never run, and the
  // watcher's first stat would ENOENT into the wait itself.
  await llmProxyPidsDir.ensure();
  const release = await acquireDirWatch({
    dir: llmProxyPidsDir.path,
    scope: "children",
    onChange: async () => {
      if (await proxyAlive()) settle();
    },
  });
  // An appearance between the first look and the watch opening sent no event.
  if (await proxyAlive()) settle();
  try {
    await promise;
  } finally {
    clearTimeout(timer);
    release();
  }
  if (!(await proxyAlive())) {
    const why =
      instance !== null && lastFailure !== null
        ? `the launch ${lastFailure}`
        : `the ${MAIN_WORKTREE_NAME} backend should be running`;
    throw new Error(
      `The LLM proxy did not come up within ${String(Math.round(timeoutMs / 1000))} s — ${why}`,
    );
  }
}

/**
 * Make the proxy answer for an `openai` endpoint: it is up, or this backend
 * is the host singleton and starts it (re-attaching a one that outlived a
 * restart), or the wait hands off to the singleton its write already woke.
 */
export async function ensureProxyUp(): Promise<void> {
  if (await proxyAlive()) {
    if (instance === null && isHostSingleton())
      instance = llmProxyDaemon.attach({
        instance: INSTANCE,
        pidFile: proxyPidPath(),
      });
    return;
  }
  if (!isHostSingleton()) {
    // This backend cannot start it — the start outside `where` throws. What
    // made it needed just wrote the accounts file, and the singleton's
    // watcher (reconcile) started it from that same write.
    await waitForProxyUp();
    return;
  }
  await launchProxy();
  await waitForProxyUp();
}

/**
 * Stop the proxy: SIGTERM the process its pid file names (it removes the file
 * as it exits), wait for the exit, drop this backend's record. Idempotent —
 * a proxy already gone is the goal.
 */
export async function stopProxy(): Promise<void> {
  if (instance !== null) {
    const rec = instance;
    instance = null;
    await rec.stop();
  }
  const read = await readPidFile(proxyPidPath());
  if (read.kind !== "pid" || !pidAlive(read.pid)) return;
  try {
    process.kill(read.pid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  let settled = false;
  const settle = (): void => {
    if (!settled) {
      settled = true;
      resolve();
    }
  };
  const timer = setTimeout(settle, 30_000);
  const release = await acquireDirWatch({
    dir: llmProxyPidsDir.path,
    scope: "children",
    onChange: async () => {
      if (!(await proxyAlive())) settle();
    },
  });
  if (!(await proxyAlive())) settle();
  try {
    await promise;
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * Bring the proxy in line with the accounts file: it runs while any endpoint
 * account speaks `openai` (an in-flight endpoint test's temporary row counts
 * — the test is waiting on it), and is stopped when none does. The host
 * singleton alone reconciles — the other backends' watches end here.
 */
export async function reconcileProxy(): Promise<void> {
  if (!isHostSingleton()) return;
  const accounts = await readClaudeAccounts();
  const needs = accounts.accounts.some(
    (a) => a.kind === "endpoint" && a.endpoint.api === "openai",
  );
  if (needs) await ensureProxyUp();
  else await stopProxy();
}
