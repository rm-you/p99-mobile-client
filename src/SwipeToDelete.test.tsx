// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SwipeToDelete from "./SwipeToDelete";

beforeEach(() => {
  class Pointer extends MouseEvent {
    readonly pointerId = 1;
    readonly isPrimary = true;
  }
  vi.stubGlobal("PointerEvent", Pointer);
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(disabled = false) {
  const remove = vi.fn(),
    connect = vi.fn();
  render(
    <ul>
      <SwipeToDelete disabled={disabled} onDelete={remove}>
        <button onClick={connect}>Character</button>
      </SwipeToDelete>
    </ul>,
  );
  const row = screen.getByRole("listitem"),
    button = screen.getByRole("button");
  const down = () =>
    fireEvent.pointerDown(button, { clientX: 200, clientY: 100, button: 0 });
  const move = (x: number, y = 100) =>
    fireEvent.pointerMove(row, { clientX: x, clientY: y });
  const up = (x: number, y = 100) =>
    fireEvent.pointerUp(row, { clientX: x, clientY: y });
  return { row, button, down, move, up, remove, connect };
}
it("requests deletion on a left swipe without also connecting", () => {
  const r = setup();
  r.down();
  r.move(100);
  fireEvent.lostPointerCapture(r.button);
  r.up(100);
  fireEvent.click(r.button, { detail: 1 });
  expect(r.remove).toHaveBeenCalledTimes(1);
  expect(r.connect).not.toHaveBeenCalled();
  // A subsequent ordinary tap still connects.
  r.down();
  r.up(200);
  fireEvent.click(r.button, { detail: 1 });
  expect(r.connect).toHaveBeenCalledTimes(1);
});
it("keeps short drags, vertical scrolling, right swipes, and cancellations harmless", () => {
  const r = setup();
  for (const [x, y] of [
    [170, 100],
    [100, 240],
    [280, 100],
  ]) {
    r.down();
    r.move(x, y);
    r.up(x, y);
  }
  r.down();
  r.move(80);
  fireEvent.pointerCancel(r.row);
  r.up(80);
  expect(r.remove).not.toHaveBeenCalled();
});
it("does not swipe disabled rows and preserves keyboard activation", () => {
  const r = setup(true);
  r.down();
  r.move(80);
  r.up(80);
  expect(r.remove).not.toHaveBeenCalled();
  fireEvent.click(r.button, { detail: 0 });
  expect(r.connect).toHaveBeenCalledTimes(1);
});
