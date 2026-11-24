import { defineCliCommand } from "@plugins/framework/plugins/cli/core";

/**
 * `./muxos url` — main's address on this account's port, for a script (install.sh)
 * or a person: the one place a shell learns the port without spelling it.
 */
export default defineCliCommand<[], object>({
  name: "url",
  description:
    "Print the address muxos is served at on this account (http://muxos.localhost:<port> — the port is chosen once from 8700–8709 by `./muxos start`). Reads only.",
  run: () => import("./url"),
});
