import type { SessionStatus } from "./protocol";

interface ConnectionDisplay {
  label: string;
  detail: string;
  healthy: boolean;
  busy: boolean;
}

/** Present session state without exposing transport diagnostics or counters. */
export function connectionDisplay(
  active: boolean,
  stopping: boolean,
  status: SessionStatus | null,
  retrying: boolean,
  now: number,
): ConnectionDisplay {
  const display = (
    label: string,
    detail: string,
    busy = false,
    healthy = false,
  ) => ({ label, detail, busy, healthy });
  if (stopping) return display("Disconnecting", "Closing connection…", true);
  if (!active || status?.state === "stopped")
    return display("Offline", "Disconnected");
  if (retrying || status?.state === "disconnected")
    return display("Reconnecting", "Connection interrupted · Retrying…", true);

  // The core reports every 30 seconds and considers 60 seconds without traffic
  // unhealthy. Include elapsed time so a suspended worker cannot stay green.
  const silence =
    status?.last_received_seconds == null
      ? null
      : status.last_received_seconds +
        Math.max(0, now / 1000 - status.timestamp);
  if (silence !== null && silence >= 60)
    return display("Interrupted", "Waiting for server…");
  if (status?.state === "connected")
    return silence === null
      ? display("Connected", "Checking connection…")
      : display("Connected", "Connection healthy", false, true);
  if (status?.state === "zoning")
    return display("Entering zone", "Entering the game world…", true);
  return display("Connecting", "Signing in to P99…", true);
}
