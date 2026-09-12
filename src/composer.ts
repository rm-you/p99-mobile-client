import type { ChatRecord } from "./protocol";

export const SEND_CHANNELS = [
  "say",
  "tell",
  "guild",
  "auction",
  "ooc",
  "shout",
] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
export type OutgoingMessage =
  | { channel: Exclude<SendChannel, "tell">; text: string }
  | { channel: "tell"; recipient: string; text: string };
export interface ReplySelection {
  recipient: string;
  sequence: number;
}

/** Match native validation; line breaks compose one message, not several sends. */
export const messageText = (text: string) =>
  text.replace(/\r\n|[\r\n]/g, " ").trim();
export const validRecipient = (name: string) =>
  /^[a-z]{1,63}$/i.test(name.trim());
export function messageError(text: string): string | null {
  const value = messageText(text);
  if (!value) return null;
  if (/[\x00-\x1f\x7f-\x9f]/.test(value))
    return "Remove control characters from the message.";
  if (new TextEncoder().encode(value).length > 4095)
    return "Message is too long. Shorten it before sending.";
  return null;
}

/** Reply privately to the identified author, regardless of the original channel. */
export function replyRecipient(record: ChatRecord): string | null {
  if (record.type !== "chat") return null;
  const name = record.sender;
  return name && validRecipient(name) ? name.trim() : null;
}

export function sendError(error: unknown): string {
  switch (error) {
    case "not_connected":
      return "Not connected. Your draft is kept; try again once connected.";
    case "invalid_message":
      return "Enter a message without control characters.";
    case "message_too_long":
      return "Message is too long. Shorten it before sending.";
    case "invalid_recipient":
      return "Enter a character name using letters only.";
    case "queue_full":
      return "Please wait a moment and try again. Your draft is kept.";
    default:
      return "Could not submit the message. Your draft is kept.";
  }
}
