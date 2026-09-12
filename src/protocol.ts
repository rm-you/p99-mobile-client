export type Server = "green" | "blue";
export type ConnectionState =
  "connecting" | "connected" | "zoning" | "disconnected" | "stopped";
/** Ordered milestones emitted by the native client for each connection attempt. */
export const CONNECTION_STAGES = [
  "connecting_login",
  "authenticating",
  "selecting_server",
  "connecting_world",
  "selecting_character",
  "connecting_zone",
  "loading_character",
  "entering_world",
  "ready",
] as const;
export type ConnectionStage = (typeof CONNECTION_STAGES)[number];
export interface ConnectRequest {
  user: string;
  pass: string;
  character: string;
  server: Server;
}
export interface ItemLink {
  body: string;
  text: string;
  start: number;
  end: number;
  item_id: number;
  /** Inclusive/exclusive UTF-8 byte offsets in the decoded message text. */
  text_start?: number;
  text_end?: number;
}
export interface Message {
  text: string;
  item_links?: ItemLink[];
}
export interface ChatRecord extends Partial<Message> {
  type: "chat" | "decode_error";
  timestamp: string;
  server: string;
  character: string;
  zone: string;
  session_id: string;
  message_id: number;
  channel_name?: string;
  /** Original numeric channel, including IDs not named by older core versions. */
  channel?: number;
  sender?: string;
  target?: string;
  string_id?: number;
  arguments?: Message[];
  error?: string;
}
export interface SessionStatus {
  state: ConnectionState;
  zone: string;
  messages: number;
  packets: number;
  last_received_seconds: number | null;
  session_id: string;
  timestamp: number;
}
export type ClientEvent =
  | { type: "status"; data: SessionStatus }
  | { type: "progress"; data: ConnectionStage }
  | { type: "record"; data: ChatRecord }
  | { type: "diagnostic"; data: string }
  | { type: "reconnecting"; data: { error: string; delay_seconds: number } };
export type AppEvent =
  | { type: "history_error" }
  | { type: "client"; data: ClientEvent }
  | {
      type: "background";
      data: {
        supported: boolean;
        active: boolean;
        notifications_enabled: boolean;
        battery_optimized: boolean;
      };
    }
  | {
      type: "finished";
      data: { error: "invalid_credentials" | "connection_lost" | null };
    };
export const MAX_RECORDS = 1500;
export const CHANNELS = [
  "auction",
  "ooc",
  "guild",
  "tell",
  "say",
  "shout",
  "emote",
  "system",
] as const;
export type ChatChannel = (typeof CHANNELS)[number];

/** P99 echoes sent tells on channel 14; older core versions call that unknown. */
export function recordChannel(record: ChatRecord): string {
  if (record.type === "chat" && record.channel === 14) return "tell";
  return record.channel_name ?? "system";
}

export function recordText(record: ChatRecord): string {
  if (record.type === "decode_error")
    return record.error ?? "A message could not be decoded.";
  if (record.text !== undefined) return record.text;
  const argumentsText = record.arguments
    ?.map((argument) => argument.text)
    .join(" · ");
  return (
    [
      record.string_id === undefined ? "" : `Game message #${record.string_id}`,
      argumentsText,
    ]
      .filter(Boolean)
      .join(": ") || "Game message"
  );
}
export function matchesChannels(
  record: ChatRecord,
  channels: ChatChannel[],
): boolean {
  const name = recordChannel(record) as ChatChannel;
  const channel =
    record.type !== "decode_error" && CHANNELS.includes(name) ? name : "system";
  return channels.includes(channel);
}

/** Guildless characters receive a blank MOTD at login; it is not a chat message. */
export function isEmptyGuildMotd(record: ChatRecord): boolean {
  return (
    record.type === "chat" &&
    record.channel_name === "guild_motd" &&
    !(
      record.text?.trim() ||
      record.arguments?.some((argument) => argument.text.trim()) ||
      record.item_links?.length ||
      record.arguments?.some((argument) => argument.item_links?.length)
    )
  );
}
