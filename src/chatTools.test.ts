import { expect, it } from "vitest";
import {
  applyEcho,
  coalesceSelfTells,
  matchesEcho,
  type Submission,
} from "./chatTools";
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

it("binds a confirmation to its exact record and ignores repeat confirmations", () => {
  const queue = [sent, { ...sent, id: 2 }];
  const confirmed = applyEcho(queue, echo);
  expect(confirmed[0].echoKey).toBe("synthetic-3");
  expect(applyEcho(confirmed, echo)).toEqual(confirmed);
  expect(applyEcho(confirmed, { ...echo, message_id: 4 })[1].echoKey).toBe(
    "synthetic-4",
  );
});

it("coalesces each self-tell receive/confirmation pair once, in either order", () => {
  const first = {
    ...echo,
    sender: "ExampleCharacter",
    target: "ExampleCharacter",
    channel: 7,
    message_id: 10,
  };
  const confirmation = { ...first, channel: 14, message_id: 11 };
  const second = { ...first, message_id: 12 };
  const secondConfirmation = { ...confirmation, message_id: 13 };
  expect(
    coalesceSelfTells([first, confirmation, second, secondConfirmation]),
  ).toEqual([confirmation, secondConfirmation]);
  expect(coalesceSelfTells([confirmation, first])).toEqual([confirmation]);
  expect(coalesceSelfTells([first, second])).toEqual([first, second]);
  expect(
    coalesceSelfTells([first, { ...confirmation, session_id: "different" }]),
  ).toHaveLength(2);
  expect(
    coalesceSelfTells([
      first,
      { ...confirmation, timestamp: "2026-01-01T00:00:10Z" },
    ]),
  ).toHaveLength(2);
  expect(
    coalesceSelfTells([echo, { ...echo, channel: 7, message_id: 4 }]),
  ).toHaveLength(2);
  const toSelf = {
    ...sent,
    message: {
      ...sent.message,
      channel: "tell" as const,
      recipient: "ExampleCharacter",
    },
  };
  expect(matchesEcho(toSelf, first)).toBe(false);
  expect(matchesEcho(toSelf, confirmation)).toBe(true);
});
