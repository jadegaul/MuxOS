// The monitor's binary, collected into infra/deps' registry through the
// `default` array (`./muxos deps install fs-latency-monitor`); the login
// service runs it from the muxos app bundle.
import { fsLatencyMonitorBinary } from "./internal/monitor-binary";

export { fsLatencyMonitorBinary } from "./internal/monitor-binary";

export default [fsLatencyMonitorBinary];
