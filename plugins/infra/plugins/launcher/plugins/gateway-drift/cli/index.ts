// Shared CLI machinery, not a command (no default export): main's gateway as
// `./muxos start` installs it, and main's follow-main restart of it (run by
// the convergence run, `./muxos build --allow-main --converge`).
export {
  completeGatewaySwitch,
  followMainGateway,
  withGatewayFollowLock,
} from "./internal/follow";
export type { GatewayFollowOutcome } from "./internal/follow";
export {
  adoptGatewayLaunch,
  holdGatewayBuild,
  prepareMainGateway,
} from "./internal/main-gateway";
export type { PreparedGateway } from "./internal/main-gateway";
