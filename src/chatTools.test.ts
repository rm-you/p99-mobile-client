import { expect, it } from "vitest";
import { applyEcho, matchesEcho, type Submission } from "./chatTools";
import type { ChatRecord } from "./protocol";
const sent: Submission = {
  id: 1,
  session: "synthetic",
  afterMessageId: 2,
  message: {
    channel: "tell",
    recipient: "ExampleFriend",
    text: "Synthetic message",
  },
  state: "submitted",
  at: 0,
};
const echo: ChatRecord = {
  type: "chat",
  timestamp: "2026-01-01T00:00:00Z",
  server: "green",
  character: "ExampleCharacter",
  sender: "examplecharacter",
  target: "examplefriend",
  session_id: "synthetic",
  message_id: 3,
  channel: 14,
  text: "Synthetic message",
  zone: "ecommons",
};
it("matches only a newer own-message echo in the same session and destination", () => {
  expect(matchesEcho(sent, echo)).toBe(true);
  for (const patch of [
    { session_id: "old" },
    { message_id: 2 },
    { sender: "OtherCharacter" },
    { target: "DifferentFriend" },
    { text: "Different message" },
    { channel: 3, channel_name: "say" },
  ])
    expect(matchesEcho(sent, { ...echo, ...patch })).toBe(false);
});
it("one echo acknowledges at most one identical submission, and never a failed one", () => {
  const queue = [
    { ...sent, id: 0, state: "failed" as const },
    sent,
    { ...sent, id: 2 },
  ];
  expect(applyEcho(queue, echo).map((s) => s.state)).toEqual([
    "failed",
    "echoed",
    "submitted",
  ]);
});
