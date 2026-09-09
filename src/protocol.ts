export type Server = "green" | "blue";
export type ConnectionState =
  "connecting" | "connected" | "zoning" | "disconnected" | "stopped";
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
  | { type: "record"; data: ChatRecord }
  | { type: "diagnostic"; data: string }
  | { type: "reconnecting"; data: { error: string; delay_seconds: number } };
export type AppEvent =
  | { type: "client"; data: ClientEvent }
  | { type: "finished"; data: { error: string | null } };
export const MAX_RECORDS = 1500;
export const CHANNELS = [
  "all",
  "auction",
  "ooc",
  "guild",
  "tell",
  "group",
  "say",
  "shout",
  "raid",
  "system",
] as const;
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
export function matchesChannel(record: ChatRecord, channel: string): boolean {
  if (channel === "all") return true;
  if (channel === "system")
    return (
      record.type === "decode_error" ||
      ["system", "motd", "guild_motd", "broadcast"].includes(
        record.channel_name ?? "",
      )
    );
  return record.channel_name === channel;
}
