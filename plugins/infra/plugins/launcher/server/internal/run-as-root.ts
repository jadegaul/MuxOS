import { defineNotice } from "@plugins/infra/plugins/launcher/plugins/installer-notice/core";

/**
 * The refusal a person reads when they run muxos as root — on a server, the
 * deploy path's default account. It follows the installer message rules
 * (`infra/launcher/installer-notice`): built at load, so a rule break fails
 * its test before anyone reads it.
 */
export const RUN_AS_ROOT = defineNotice({
  title: "muxos cannot run as root, the administrator account",
  doing:
    "muxos was starting its own database, where it keeps your tasks, pages and settings.",
  blocked:
    "That database refuses to run as root for safety, so muxos cannot start under that account.",
  now: [
    "Sign in as an ordinary account and run the same command again.",
    "On a server, create one with `adduser --disabled-password --gecos '' muxos`, give it the folder muxos is in with `chown -R muxos:muxos <muxos folder>`, then switch to it with `su - muxos` and run the same command again.",
  ],
  ifSkipped: {
    optional: false,
    because:
      "that database is where muxos keeps everything, so muxos cannot start without it.",
  },
  evidence: [
    "uid 0 (root)",
    "Postgres' initdb refuses to run as the root OS user, so the embedded cluster and every backend behind it cannot start",
  ],
});
