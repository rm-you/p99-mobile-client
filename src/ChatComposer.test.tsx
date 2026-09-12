// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChatComposer from "./ChatComposer";
import { messageError, replyRecipient } from "./composer";
import type { ChatRecord } from "./protocol";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const input = () => screen.getByRole("textbox", { name: "Message" });
const button = () =>
  screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
function setup(connected = true) {
  const send = vi.fn().mockResolvedValue(undefined);
  const props = { hidden: false, connected, reply: null, onSend: send };
  const view = render(<ChatComposer {...props} />);
  return { send, props, ...view };
}
it("offers only supported channels and submits one normalized message through the icon button", async () => {
  const r = setup();
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Say", "Tell", "Guild", "Auction", "OOC", "Shout"]);
  expect(input().getAttribute("rows")).toBe("1");
  expect(button().disabled).toBe(true);
  expect(button().querySelector("svg")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ooc" } });
  fireEvent.change(input(), { target: { value: "one\ntwo" } });
  fireEvent.click(button());
  expect(r.send).toHaveBeenCalledWith({ channel: "ooc", text: "one two" });
  await waitFor(() => expect((input() as HTMLTextAreaElement).value).toBe(""));
});
it("selects a tell recipient and focuses the preserved draft without sending", () => {
  const r = setup();
  fireEvent.change(input(), { target: { value: "my draft" } });
  r.rerender(
    <ChatComposer
      {...r.props}
      reply={{ recipient: "ExampleFriend", sequence: 1 }}
    />,
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "tell",
  );
  expect(
    (screen.getByLabelText("Tell recipient") as HTMLInputElement).value,
  ).toBe("ExampleFriend");
  expect((input() as HTMLTextAreaElement).value).toBe("my draft");
  expect(document.activeElement).toBe(input());
  expect(r.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Tell recipient"), {
    target: { value: "Bad Name" },
  });
  expect(button().disabled).toBe(true);
});
it("requires a connection and rejects oversized UTF-8 text", () => {
  const r = setup(false);
  fireEvent.change(input(), { target: { value: "draft" } });
  fireEvent.click(button());
  expect(r.send).not.toHaveBeenCalled();
  r.rerender(<ChatComposer {...r.props} connected />);
  fireEvent.change(input(), { target: { value: "é".repeat(2048) } });
  expect(button().disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toMatch(/too long/);
  expect(messageError("example\0private")).toMatch(/control characters/);
});
it("keeps failed drafts, hides internal errors, and suppresses duplicate submissions", async () => {
  const r = setup();
  let reject!: (reason: string) => void;
  r.send.mockImplementation(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  fireEvent.change(input(), { target: { value: "keep this" } });
  fireEvent.click(button());
  fireEvent.submit(screen.getByRole("form"));
  expect(r.send).toHaveBeenCalledTimes(1);
  await act(async () => reject("INTERNAL_SYNTHETIC_DIAGNOSTIC"));
  expect((input() as HTMLTextAreaElement).value).toBe("keep this");
  expect(screen.getByRole("alert").textContent).toMatch(/draft is kept/);
  expect(screen.queryByText(/INTERNAL_SYNTHETIC/)).toBeNull();
});
it("keeps drafts typed while sending and across hidden tabs", async () => {
  const r = setup();
  let done!: () => void;
  r.send.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  fireEvent.change(input(), { target: { value: "first" } });
  fireEvent.click(button());
  fireEvent.change(input(), { target: { value: "next draft" } });
  await act(async () => done());
  r.rerender(<ChatComposer {...r.props} hidden />);
  r.rerender(<ChatComposer {...r.props} />);
  expect((input() as HTMLTextAreaElement).value).toBe("next draft");
});
it("grows with content and caps the text area at four lines", () => {
  setup();
  const field = input();
  Object.defineProperty(field, "scrollHeight", {
    configurable: true,
    value: 88,
  });
  fireEvent.change(field, { target: { value: "one\ntwo\nthree" } });
  expect(field.style.height).toBe("90px");
  Object.defineProperty(field, "scrollHeight", {
    configurable: true,
    value: 240,
  });
  fireEvent.change(field, { target: { value: "one\ntwo\nthree\nfour\nfive" } });
  expect(field.style.height).toBe("112px");
});
it("always replies to the author across chat channels, including outgoing echoes", () => {
  const record: ChatRecord = {
    type: "chat",
    timestamp: "2026-01-01T00:00:00Z",
    server: "Example",
    zone: "example",
    character: "ExampleCharacter",
    session_id: "synthetic",
    message_id: 1,
    channel_name: "tell",
    sender: "ExampleFriend",
    target: "ExampleCharacter",
    text: "example",
  };
  expect(replyRecipient(record)).toBe("ExampleFriend");
  expect(
    replyRecipient({
      ...record,
      sender: "examplecharacter",
      target: "ExampleFriend",
    }),
  ).toBe("examplecharacter");
  for (const channel_name of [
    "say",
    "auction",
    "ooc",
    "guild",
    "shout",
    "emote",
    "unknown",
  ]) {
    expect(replyRecipient({ ...record, channel_name })).toBe("ExampleFriend");
  }
  expect(replyRecipient({ ...record, sender: undefined })).toBeNull();
  expect(replyRecipient({ ...record, type: "decode_error" })).toBeNull();
  expect(replyRecipient({ ...record, sender: "Invalid Sender" })).toBeNull();
});
