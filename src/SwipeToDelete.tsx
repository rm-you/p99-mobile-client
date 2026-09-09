import { useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

/** Recognize a deliberate left swipe while preserving vertical scrolling and tap actions. */
export default function SwipeToDelete({
  children,
  disabled,
  onDelete,
}: {
  children: ReactNode;
  disabled: boolean;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const reset = () => {
    gesture.current = null;
    setOffset(0);
  };
  function move(event: PointerEvent<HTMLLIElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId || disabled) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (!start.dragging && dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      start.dragging = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.dragging) setOffset(Math.max(-96, Math.min(0, dx)));
  }
  return (
    <li
      className="swipe-profile"
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (!disabled && event.isPrimary !== false && event.button === 0)
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
          };
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        const remove =
          !disabled &&
          start.dragging &&
          dx <= -72 &&
          Math.abs(dx) > Math.abs(dy) * 1.5;
        reset();
        if (remove) onDelete();
      }}
      onPointerCancel={reset}
      onLostPointerCapture={(event) => {
        // Touch initially belongs to the tapped button. Its lost-capture event
        // bubbles when the row takes ownership, so only reset for the row itself.
        if (event.target === event.currentTarget) reset();
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <span
        className="swipe-delete-hint"
        aria-hidden="true"
        style={{ opacity: offset ? 1 : 0 }}
      >
        Delete
      </span>
      <div
        className="profile-row"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </li>
  );
}
