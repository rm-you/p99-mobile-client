import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ItemLink } from "./protocol";

export interface ItemDetails {
  name: string;
  source_url: string;
  lines: string[];
  fetched_at: number;
}
type Lookup =
  | { state: "loading" }
  | { state: "ready"; item: ItemDetails }
  | { state: "error"; message: string };

/** Native dialog keeps focus inside the item view and restores it when closed. */
export default function ItemModal({
  item,
  onClose,
}: {
  item: ItemLink;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [browserError, setBrowserError] = useState("");
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLookup({ state: "loading" });
    void invoke<ItemDetails>("item_details", { name: item.text }).then(
      (details) => {
        if (!cancelled) setLookup({ state: "ready", item: details });
      },
      (error: unknown) => {
        if (!cancelled)
          setLookup({
            state: "error",
            message:
              typeof error === "string"
                ? error
                : "Item details are unavailable. Please try again.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.text, attempt]);

  const details = lookup.state === "ready" ? lookup.item : null;
  async function openWiki() {
    setBrowserError("");
    try {
      await invoke("open_item_wiki", { name: details?.name ?? item.text });
    } catch {
      setBrowserError("Could not open the Wiki in your browser.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="item-modal"
      aria-labelledby="item-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="item-modal-header">
        <h2 id="item-title">{details?.name ?? item.text}</h2>
        <button
          className="item-close"
          type="button"
          aria-label="Close item details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="item-modal-body" aria-busy={lookup.state === "loading"}>
        {lookup.state === "loading" && (
          <div className="item-loading" role="status">
            Loading item details…
          </div>
        )}
        {lookup.state === "error" && (
          <div className="item-error">
            <p role="alert">{lookup.message}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {details && (
          <div className="item-stats">
            {details.lines.map((line, index) => {
              const colon = line.indexOf(":");
              return colon > 0 ? (
                <div className="item-stat" key={index}>
                  <span>{line.slice(0, colon)}</span>
                  <strong>{line.slice(colon + 1).trim()}</strong>
                </div>
              ) : (
                <p className="item-flags" key={index}>
                  {line}
                </p>
              );
            })}
          </div>
        )}
      </div>
      <footer className="item-modal-footer">
        <button
          className="wiki-link"
          type="button"
          onClick={() => void openWiki()}
        >
          View on P99 Wiki
        </button>
        {browserError && <p role="alert">{browserError}</p>}
      </footer>
    </dialog>
  );
}
