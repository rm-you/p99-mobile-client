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
  echoKey?: string;
}
/** Match the session, destination and content without conflating repeated sends. */
export function matchesSubmission(
  sent: Submission,
  record: ChatRecord,
): boolean {
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
export const isSelfTell = (record: ChatRecord) =>
  isOwnMessage(record) &&
  !!record.target &&
  record.target.toLowerCase() === record.character.toLowerCase() &&
  (record.channel === 7 || record.channel === 14);

/** Pair the received and confirmation records of a self-tell for display only. */
export function coalesceSelfTells(records: ChatRecord[]): ChatRecord[] {
  const waiting = new Map<string, ChatRecord[]>();
  const hidden = new Set<string>();
  for (const record of records) {
    if (!isSelfTell(record)) continue;
    const key = JSON.stringify([
      record.session_id,
      record.character.toLowerCase(),
      record.text,
    ]);
    const candidates = waiting.get(key) ?? [];
    const index = candidates.findIndex(
      (other) =>
        other.channel !== record.channel &&
        Math.abs(Date.parse(other.timestamp) - Date.parse(record.timestamp)) <=
          2000,
    );
    if (index >= 0) {
      const [other] = candidates.splice(index, 1);
      hidden.add(recordKey(record.channel === 7 ? record : other));
    } else candidates.push(record);
    waiting.set(key, candidates);
  }
  return records.filter((record) => !hidden.has(recordKey(record)));
}

/** A server confirmation is not a read receipt; a self-tell's incoming half is separate. */
export function matchesEcho(sent: Submission, record: ChatRecord): boolean {
  return (
    matchesSubmission(sent, record) &&
    !(isSelfTell(record) && record.channel === 7)
  );
}
export function applyEcho(
  queue: Submission[],
  record: ChatRecord,
): Submission[] {
  const echoKey = recordKey(record);
  if (queue.some((sent) => sent.echoKey === echoKey)) return queue;
  const index = queue.findIndex(
    (s) =>
      ["submitting", "submitted", "unconfirmed"].includes(s.state) &&
      matchesEcho(s, record),
  );
  return queue.map((s, i) =>
    i === index ? { ...s, state: "echoed", echoKey } : s,
  );
}
