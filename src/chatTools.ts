import { recordChannel, recordText } from "./protocol";
import type { ChatRecord } from "./protocol";
import type { OutgoingMessage } from "./composer";
export const recordKey = (record: ChatRecord) =>
  `${record.session_id}-${record.message_id}`;
export const isOwnMessage = (record: ChatRecord) =>
  !!record.sender &&
  record.sender.toLowerCase() === record.character.toLowerCase();
export const incomingMessage = (record: ChatRecord) =>
  record.type === "chat" && !!record.sender && !isOwnMessage(record);
export const transcript = (record: ChatRecord) =>
  `[${new Date(record.timestamp).toLocaleString()}] ${recordChannel(record)} ${record.sender || "Norrath"}${record.target ? ` → ${record.target}` : ""}: ${recordText(record)}`;
export interface Submission {
  id: number;
  message: OutgoingMessage;
  session: string;
  afterMessageId: number;
  state: "submitting" | "submitted" | "echoed" | "unconfirmed" | "failed";
  at: number;
}
/** Echo matching is evidence of a server response, not proof that another player read it. */
export function matchesEcho(sent: Submission, record: ChatRecord): boolean {
  return (
    sent.session === record.session_id &&
    record.message_id > sent.afterMessageId &&
    isOwnMessage(record) &&
    record.text === sent.message.text &&
    recordChannel(record) === sent.message.channel &&
    (sent.message.channel !== "tell" ||
      record.target?.toLowerCase() === sent.message.recipient.toLowerCase())
  );
}
export function applyEcho(
  queue: Submission[],
  record: ChatRecord,
): Submission[] {
  const index = queue.findIndex(
    (s) =>
      ["submitting", "submitted", "unconfirmed"].includes(s.state) &&
      matchesEcho(s, record),
  );
  return queue.map((s, i) => (i === index ? { ...s, state: "echoed" } : s));
}
