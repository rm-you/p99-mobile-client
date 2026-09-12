import { useLayoutEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { replyRecipient } from "./composer";
import { transcript } from "./chatTools";
import { recordText } from "./protocol";
import type { ChatRecord } from "./protocol";
export default function MessageActions({
  record,
  muted,
  onReply,
  onMute,
  onClose,
}: {
  record: ChatRecord;
  muted: boolean;
  onReply: (name: string) => void;
  onMute: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recipient = replyRecipient(record);
  useLayoutEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  async function action(kind: "copy" | "share") {
    setBusy(true);
    setError("");
    try {
      if (isTauri())
        await invoke(kind === "copy" ? "copy_message" : "share_document", {
          text: kind === "copy" ? recordText(record) : transcript(record),
          format: "txt",
        });
      else if (kind === "copy")
        await navigator.clipboard.writeText(recordText(record));
      else if (navigator.share)
        await navigator.share({ text: transcript(record) });
      else throw Error();
      onClose();
    } catch {
      setError(
        kind === "copy"
          ? "Could not copy this message."
          : "Could not open sharing.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="item-modal action-sheet"
      aria-labelledby="message-actions-title"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="item-modal-header">
        <h2 id="message-actions-title">Message actions</h2>
        <button
          className="item-close"
          aria-label="Close message actions"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="action-preview">{recordText(record)}</p>
      <div className="action-list">
        {recipient && (
          <button
            disabled={busy}
            onClick={() => {
              onReply(recipient);
              onClose();
            }}
          >
            Tell {recipient}
          </button>
        )}
        <button disabled={busy} onClick={() => void action("copy")}>
          Copy message
        </button>
        <button disabled={busy} onClick={() => void action("share")}>
          Share message
        </button>
        {recipient && (
          <button
            disabled={busy}
            onClick={() => {
              onMute(recipient);
              onClose();
            }}
          >
            {muted ? "Unmute" : "Mute"} {recipient}
          </button>
        )}
      </div>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
