import { defineConfig } from "@plugins/config_v2/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";

export const costConfig = defineConfig({
  fields: {
    repoOnly: boolField({
      default: true,
      label: "muxos sessions only",
      description:
        "When enabled, charts include only Claude sessions launched by muxos (joined by claudeSessionId). When disabled, every Claude Code session on this machine is counted — including ad-hoc sessions outside muxos.",
    }),
  },
});
