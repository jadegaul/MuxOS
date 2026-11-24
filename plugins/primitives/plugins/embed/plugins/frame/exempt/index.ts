import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "frame/no-raw-frame",
    paths: ["web/components/frames.tsx"],
    kind: "sanctioned",
    reason:
      "The framing primitive itself: the one file that renders an <iframe>, each of its five frames building or classifying its own URL so `allow-same-origin` is only ever granted off the app origin.",
  },
  {
    rule: "namespace:no-hand-built-url",
    paths: ["core/classify-url.ts"],
    kind: "sanctioned",
    reason:
      "Not namespace identity: an embed guard refusing every *.localhost host (any local server, muxos's or not), after namespaceFromHost / isContentHost have refused muxos's own.",
  },
] satisfies Exemptions;
