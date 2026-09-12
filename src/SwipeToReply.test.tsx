// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SwipeToReply from "./SwipeToReply";

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
function setup() {
  const reply = vi.fn(),
    item = vi.fn();
  const view = render(
    <SwipeToReply onReply={reply}>
      <button onClick={item}>Example item</button>
    </SwipeToReply>,
  );
  const row = view.container.firstElementChild!,
    button = screen.getByRole("button");
  const down = () =>
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100, button: 0 });
  const move = (x: number, y = 100) =>
    fireEvent.pointerMove(row, { clientX: x, clientY: y });
  const up = (x: number, y = 100) =>
    fireEvent.pointerUp(row, { clientX: x, clientY: y });
  return { reply, item, row, button, down, move, up };
}
it.each([1, -1])(
  "selects a reply on either swipe direction (%s) without opening the item",
  (direction) => {
    const r = setup();
    r.down();
    r.move(100 + direction * 80);
    expect(
      (r.row.querySelector(".reply-content") as HTMLElement).style.transform,
    ).toBe(`translateX(${direction * 80}px)`);
    fireEvent.lostPointerCapture(r.button);
    r.up(100 + direction * 80);
    fireEvent.click(r.button, { detail: 1 });
    expect(r.reply).toHaveBeenCalledTimes(1);
    expect(r.item).not.toHaveBeenCalled();
    r.down();
    r.up(100);
    fireEvent.click(r.button, { detail: 1 });
    expect(r.item).toHaveBeenCalledTimes(1);
  },
);
it("preserves scrolling, short drags in either direction, cancellation, and keyboard item activation", () => {
  const r = setup();
  for (const [x, y] of [
    [130, 100],
    [70, 100],
    [180, 220],
    [20, 220],
  ]) {
    r.down();
    r.move(x, y);
    r.up(x, y);
  }
  r.down();
  r.move(180);
  fireEvent.pointerCancel(r.row);
  r.up(180);
  expect(r.reply).not.toHaveBeenCalled();
  fireEvent.click(r.button, { detail: 0 });
  expect(r.item).toHaveBeenCalledTimes(1);
});

it("opens actions only for a stationary long press, not scrolls, item buttons or cancelled gestures", () => {
  vi.useFakeTimers();
  try {
    const hold = vi.fn();
    const view = render(
      <SwipeToReply onLongPress={hold}>
        <span>Message text</span>
        <button>Item link</button>
      </SwipeToReply>,
    );
    const text = screen.getByText("Message text"),
      row = view.container.firstElementChild!;
    const down = (target = text) =>
      fireEvent.pointerDown(target, { clientX: 20, clientY: 20, button: 0 });
    down();
    act(() => vi.advanceTimersByTime(500));
    expect(hold).toHaveBeenCalledTimes(1);
    down();
    fireEvent.pointerMove(row, { clientX: 20, clientY: 40 });
    act(() => vi.advanceTimersByTime(600));
    down();
    fireEvent.pointerCancel(row);
    act(() => vi.advanceTimersByTime(600));
    down(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(600));
    expect(hold).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
