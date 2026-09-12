import type { Submission } from "./chatTools";

/** A quiet receipt on the message, with the full state available to assistive tools. */
export default function MessageDelivery({
  state,
}: {
  state: Submission["state"];
}) {
  const label =
    state === "echoed"
      ? "Sent"
      : state === "failed"
        ? "Not sent"
        : state === "unconfirmed"
          ? "Unconfirmed"
          : "Sending";
  const title =
    state === "unconfirmed"
      ? "Confirmation unavailable. This message may have been sent."
      : state === "failed"
        ? "Not sent. Your draft is still in the composer."
        : label;
  return (
    <span
      className={`message-delivery ${state}`}
      role="status"
      aria-label={label}
      title={title}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {state === "echoed" ? (
          <path d="m5 12 4 4L19 6" />
        ) : state === "failed" ? (
          <>
            <path d="m12 3 10 18H2L12 3Z" />
            <path d="M12 9v4m0 4h.01" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        )}
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
