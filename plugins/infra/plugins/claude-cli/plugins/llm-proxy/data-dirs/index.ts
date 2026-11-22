import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * The LLM translator proxy's pid file, `proxy.pid` — written by the process
 * itself once it has bound its loopback port, removed as it exits. One process
 * per machine (the host singleton's daemon); every backend that wants one
 * reads this file to tell whether it is already running.
 */
export const llmProxyPidsDir = defineDataDir({
  kind: "locks",
  name: "llm-proxy",
  owner: "infra/claude-cli/llm-proxy",
  description:
    "The LLM translator proxy's pid file — alive exactly while the process holds its loopback port",
  // A pid means nothing once its process is gone; a live proxy's file is
  // re-checked against its pid at every read.
  reclaim: { kind: "restart" },
});

/**
 * The proxy's log (`proxy.log`) — its stdout and stderr, appended across
 * incarnations: a launch that fails to bind, a translator's throw on a new
 * block type, an upstream's words when a turn fails. Append-only, the kind
 * that is reclaimable wholesale.
 */
export const llmProxyLogsDir = defineDataDir({
  kind: "logs",
  name: "llm-proxy",
  owner: "infra/claude-cli/llm-proxy",
  description:
    "The LLM translator proxy's log (stdout/stderr of the one process, appended)",
  // Observability output: losing it loses the words of a past failure — the
  // proxy itself never needs it.
  reclaim: { kind: "safe" },
});

export default [llmProxyPidsDir, llmProxyLogsDir];
