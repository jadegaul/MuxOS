import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "boundaries/no-platform-api",
    paths: ["server/internal/bin.ts"],
    kind: "debt",
    task: "task-1792338443-riwqev",
    reason: "not yet split into server/ + machine/",
  },
  {
    rule: "product-name:legacy-id",
    paths: [
      "plugins/publish-watch/server/index.ts",
      "CLAUDE.md",
      "plugins/publish-watch/CLAUDE.md",
    ],
    kind: "sanctioned",
    reason:
      "Spell the upstream org's repository names and the npm scope its binary packages publish under — both survive the rename, and installs pin the published registry names (LEGACY_IDS.npmScope).",
  },
  {
    rule: "product-name:legacy",
    paths: [
      "CLAUDE.md",
      "plugins/publish-watch/CLAUDE.md",
      "plugins/publish-watch/server/index.ts",
    ],
    kind: "sanctioned",
    reason:
      "Name the upstream org's published package scope, which keeps its name across the rename (LEGACY_IDS.npmScope).",
  },
] satisfies Exemptions;
