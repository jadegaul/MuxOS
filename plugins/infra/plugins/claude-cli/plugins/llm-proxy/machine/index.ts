import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { watchClaudeAccounts } from "@plugins/infra/plugins/claude-cli/plugins/accounts/machine";
import {
  addClaudeEndpoint,
  testClaudeEndpoint,
  updateClaudeEndpoint,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/core";
import { llmProxyDaemon, reconcileProxy } from "./internal/proxy-daemon";
import {
  handleAddClaudeEndpoint,
  handleTestClaudeEndpoint,
  handleUpdateClaudeEndpoint,
} from "./internal/routes";

export default {
  description:
    "The local LLM translator proxy, desktop half: one bun process per machine (bin/proxy.ts, the claude-cli.llm-proxy daemon, host-singleton, started detached and followed by its pid file) answering Claude Code's Anthropic messages calls at http://127.0.0.1:8800/p/<account> (Claude Code appends its own /v1/… paths — the base must not carry /v1) — an `openai` endpoint account's requests translated to its chat/completions (shared/translate, stream included), an `anthropic` endpoint's passed through at itself, the account's settings read per request from the machine-wide accounts file and its bearer token from the secrets store. The host singleton reconciles it against that file at boot and on every rewrite of it (main's watcher sees every worktree's write): it runs while any endpoint account speaks openai (a test's temporary row counts) and is stopped when none does; the other backends never start it — their endpoint test waits, bounded, for the singleton the test's own write woke. The endpoints an account is tested and added through (accounts core's declarations, implemented here because the test runs a real Claude Code turn — the SDK session, the proxy): POST /api/claude-accounts/test (one initialize and one turn on a temporary `test-…` row, deleted with its token after) and POST /api/claude-accounts/add-endpoint (the same test first — a broken endpoint is never stored).",
  httpRoutes: {
    [testClaudeEndpoint.route]: handleTestClaudeEndpoint,
    [addClaudeEndpoint.route]: handleAddClaudeEndpoint,
    [updateClaudeEndpoint.route]: handleUpdateClaudeEndpoint,
  },
  register: [llmProxyDaemon],
  onReady: () => {
    // At boot, and on every rewrite of the accounts file (any backend's
    // write — main's watcher sees them all): run the proxy while an openai
    // endpoint account exists, stop it when none does.
    void reconcileProxy();
    void watchClaudeAccounts(() => {
      void reconcileProxy();
    });
  },
} satisfies MachinePluginDefinition;
