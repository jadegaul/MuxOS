import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "no-raw-sse",
    paths: ["bin/proxy.ts"],
    kind: "sanctioned",
    reason:
      "the proxy IS the translated stream: it reads the endpoint's OpenAI SSE upstream and answers Claude Code with Anthropic SSE (shared/translate.ts's StreamMapper) — no live-state collection can sit between two wire formats",
  },
] satisfies Exemptions;
