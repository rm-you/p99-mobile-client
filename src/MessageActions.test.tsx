// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MessageActions from "./MessageActions";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("dismisses backdrop taps but keeps taps within the popup open", () => {
  const close = vi.fn();
  render(
    <MessageActions
      record={{
        type: "chat",
        timestamp: "2026-01-01T00:00:00Z",
        server: "green",
        character: "ExampleCharacter",
        sender: "ExampleFriend",
        zone: "ecommons",
        session_id: "synthetic",
        message_id: 1,
        text: "Synthetic message",
      }}
      muted={false}
      onReply={vi.fn()}
      onMute={vi.fn()}
      onClose={close}
    />,
  );
  const dialog = screen.getByRole("dialog");
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 400,
    top: 500,
    bottom: 800,
  } as DOMRect);
  fireEvent.click(dialog, { clientX: 200, clientY: 600 });
  fireEvent.click(screen.getByText("Synthetic message"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(dialog, { clientX: 200, clientY: 200 });
  expect(close).toHaveBeenCalledOnce();
});
