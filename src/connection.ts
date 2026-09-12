import { CONNECTION_STAGES } from "./protocol";
import type { ConnectionStage, SessionStatus } from "./protocol";

const STAGE_LABELS: Record<ConnectionStage, string> = {
  connecting_login: "Signing in…",
  authenticating: "Checking login details…",
  selecting_server: "Selecting server…",
  connecting_world: "Connecting to server…",
  selecting_character: "Selecting character…",
  connecting_zone: "Connecting to zone…",
  loading_character: "Loading character…",
  entering_world: "Entering the game world…",
  ready: "Connected",
};

interface ConnectionDisplay {
  label: string;
  detail: string;
  healthy: boolean;
  busy: boolean;
  progress: number | null;
}

/** Present session state without exposing transport diagnostics or counters. */
export function connectionDisplay(
  active: boolean,
  stopping: boolean,
  status: SessionStatus | null,
  retrying: boolean,
  now: number,
  stage: ConnectionStage,
): ConnectionDisplay {
  const display = (
    label: string,
    detail: string,
    busy = false,
    healthy = false,
    progress: number | null = null,
  ) => ({ label, detail, busy, healthy, progress });
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
  const progress = Math.round(
    (CONNECTION_STAGES.indexOf(stage) / (CONNECTION_STAGES.length - 1)) * 100,
  );
  return display(
    status?.state === "zoning" ? "Entering zone" : "Connecting",
    STAGE_LABELS[stage],
    true,
    false,
    progress,
  );
}
