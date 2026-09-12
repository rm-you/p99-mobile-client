// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MessageRow from "./MessageRow";
import { matchesChannels } from "./protocol";
import type { ChatRecord } from "./protocol";

afterEach(cleanup);

const outgoingTell: ChatRecord = {
  type: "chat",
  timestamp: "2026-01-01T00:00:00Z",
  server: "Example server",
  zone: "example",
  character: "ExampleCharacter",
  session_id: "synthetic",
  message_id: 1,
  channel: 14,
  channel_name: "unknown",
  sender: "ExampleCharacter",
  target: "ExampleFriend",
  text: "Example sent tell",
};

it("displays sent-tell echoes as Tell and filters them with incoming tells", () => {
  const reply = vi.fn(),
    actions = vi.fn();
  const view = render(
    <MessageRow
      record={outgoingTell}
      onItem={vi.fn()}
      onReply={reply}
      onActions={actions}
    />,
  );
  expect(view.container.querySelector(".message.channel-tell")).toBeTruthy();
  expect(screen.getByText("tell", { selector: ".channel-name" })).toBeTruthy();
  expect(screen.queryByText("unknown")).toBeNull();
  expect(screen.getByText("to ExampleFriend")).toBeTruthy();
  expect(matchesChannels(outgoingTell, ["tell"])).toBe(true);
  expect(matchesChannels(outgoingTell, ["system"])).toBe(false);
  expect(
    matchesChannels({ ...outgoingTell, channel: 7, channel_name: "tell" }, [
      "tell",
    ]),
  ).toBe(true);
  // A visually hidden native button keeps actions available without visible row icons.
  const action = screen.getByRole("button", {
    name: "Actions for ExampleCharacter message",
  });
  expect(action.classList.contains("sr-only")).toBe(true);
  fireEvent.click(action);
  expect(actions).toHaveBeenCalledWith(outgoingTell);
  expect(screen.queryByRole("button", { name: /Reply to/ })).toBeNull();
  expect(outgoingTell.channel_name).toBe("unknown");
});

it("does not reinterpret unrelated unknown channels or invent system-message authors", () => {
  const record = { ...outgoingTell, channel: 999, sender: undefined };
  render(<MessageRow record={record} onItem={vi.fn()} onReply={vi.fn()} />);
  expect(screen.getByText("unknown")).toBeTruthy();
  expect(matchesChannels(record, ["tell"])).toBe(false);
  expect(matchesChannels(record, ["system"])).toBe(true);
  expect(screen.queryByRole("button", { name: /Reply/ })).toBeNull();
});
