import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A deliberate horizontal swipe selects a tell reply without sending or opening a link. */
export default function SwipeToReply({
  children,
  onReply,
  onLongPress,
}: {
  children: ReactNode;
  onReply?: () => void;
  onLongPress?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(() => () => cancelHold(), []);
  const suppressClick = useRef(false);
  const reset = () => {
    cancelHold();
    gesture.current = null;
    setOffset(0);
  };
  return (
    <div
      className={`reply-swipe${offset ? " dragging" : ""}`}
      onPointerDown={(event) => {
        suppressClick.current = false;
        cancelHold();
        if (event.isPrimary !== false && event.button === 0) {
          if (
            onLongPress &&
            !(event.target as HTMLElement).closest("button, a, input")
          ) {
            hold.current = setTimeout(() => {
              suppressClick.current = true;
              reset();
              onLongPress();
            }, 500);
          }
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
          };
        }
      }}
      onPointerMove={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelHold();
        if (
          !start.dragging &&
          Math.abs(dy) > 12 &&
          Math.abs(dy) >= Math.abs(dx)
        ) {
          reset();
          return;
        }
        if (
          onReply &&
          !start.dragging &&
          Math.abs(dx) > 12 &&
          Math.abs(dx) > Math.abs(dy) * 1.5
        ) {
          start.dragging = true;
          suppressClick.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (start.dragging) {
          event.preventDefault();
          setOffset(Math.max(-80, Math.min(80, dx)));
        }
      }}
      onPointerUp={(event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        const reply =
          start.dragging &&
          Math.abs(dx) >= 64 &&
          Math.abs(dx) > Math.abs(dy) * 1.5;
        reset();
        if (reply) onReply?.();
      }}
      onContextMenu={(event) => {
        if (
          onLongPress &&
          !(event.target as HTMLElement).closest("button, a, input")
        ) {
          event.preventDefault();
          reset();
          onLongPress();
        }
      }}
      onPointerCancel={reset}
      onLostPointerCapture={(event) => {
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
        className="swipe-reply-hint"
        aria-hidden="true"
        style={{
          opacity: Math.min(1, Math.abs(offset) / 64),
          left: offset < 0 ? "auto" : undefined,
          right: offset < 0 ? 12 : undefined,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 4-6 6 6 6M3 10h10a8 8 0 0 1 8 8" />
        </svg>
      </span>
      <div
        className="reply-content"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
