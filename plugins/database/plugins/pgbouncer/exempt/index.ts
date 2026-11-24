import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "boundaries/no-platform-api",
    paths: ["shared/internal/paths.ts"],
    kind: "debt",
    task: "task-1792338443-riwqev",
    reason: "not yet split into server/ + machine/",
  },
  {
    rule: "check-thread-safety/no-blocking-check-work",
    paths: ["check/internal/socket-buffer-probe.ts"],
    kind: "sanctioned",
    reason:
      "The `pgbouncer:unix-socket-buffer` check's probe runs in a process of its own (spawnCaptured), never on the check thread, and blocking its own event loop is the very thing it measures: it stands in for a busy backend while it waits for the fake Postgres's sent marker (existsSync), and the fake writes that marker from its own process (writeFileSync).",
  },
  {
    rule: "product-name:legacy-id",
    paths: [
      "check/index.ts",
      "core/internal/lanes.ts",
      "plugins/publish-watch/server/index.ts",
      "CLAUDE.md",
      "plugins/publish-watch/CLAUDE.md",
      "plugins/binary/CLAUDE.md",
    ],
    kind: "sanctioned",
    reason:
      "Spell the upstream org's repository names and the npm scope its binary packages publish under — both survive the rename, and installs pin the published registry names (LEGACY_IDS.npmScope).",
  },
  {
    rule: "product-name:legacy",
    paths: [
      "CLAUDE.md",
      "plugins/binary/CLAUDE.md",
      "plugins/publish-watch/CLAUDE.md",
      "plugins/publish-watch/server/index.ts",
    ],
    kind: "sanctioned",
    reason:
      "Name the upstream org's published package scope, which keeps its name across the rename (LEGACY_IDS.npmScope).",
  },
] satisfies Exemptions;
