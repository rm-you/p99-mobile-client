import { useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Server } from "./protocol";
import {
  SEND_CHANNELS,
  messageError,
  messageText,
  sendError,
  validRecipient,
} from "./composer";
import type { OutgoingMessage, ReplySelection, SendChannel } from "./composer";

/** A single-line composer grows to four lines and retains drafts until locally accepted. */
export default function ChatComposer({
  hidden,
  server = "green",
  connected,
  reply,
  onSend,
}: {
  hidden: boolean;
  server?: Server;
  connected: boolean;
  reply: ReplySelection | null;
  onSend: (message: OutgoingMessage) => Promise<void>;
}) {
  const [channel, setChannel] = useState<SendChannel>("say");
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(0);

  useLayoutEffect(() => {
    if (!reply) return;
    revision.current += 1;
    setChannel("tell");
    setRecipient(reply.recipient);
    setError("");
    input.current?.focus();
  }, [reply]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element || hidden) return;
    const resize = () => {
      element.style.height = "0px";
      element.style.height = `${Math.min(112, Math.max(44, element.scrollHeight + 2))}px`;
    };
    resize();
    // Observe the container's width, not the textarea height we are adjusting.
    if (typeof ResizeObserver === "undefined") return;
    let width = element.parentElement?.clientWidth;
    const watch = new ResizeObserver(() => {
      const next = element.parentElement?.clientWidth;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    if (element.parentElement) watch.observe(element.parentElement);
    return () => watch.disconnect();
  }, [text, hidden]);

  const invalid = messageError(text, server);
  const targetInvalid = channel === "tell" && !validRecipient(recipient);
  const canSend =
    connected && !sending && !!messageText(text) && !invalid && !targetInvalid;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || busy.current) return;
    busy.current = true;
    setSending(true);
    setError("");
    const original = revision.current;
    try {
      const message: OutgoingMessage =
        channel === "tell"
          ? { channel, recipient: recipient.trim(), text: messageText(text) }
          : { channel, text: messageText(text) };
      await onSend(message);
      // Preserve anything typed while the IPC request was in flight.
      if (revision.current === original) setText("");
    } catch (failure) {
      setError(sendError(failure));
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <form
      className="chat-composer"
      hidden={hidden}
      aria-label="Compose message"
      onSubmit={(event) => void submit(event)}
    >
      {channel === "tell" && (
        <label className="tell-recipient">
          Tell →
          <input
            aria-label="Tell recipient"
            placeholder="character name"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={63}
            value={recipient}
            onChange={(event) => {
              revision.current += 1;
              setRecipient(event.target.value);
              setError("");
            }}
            aria-invalid={!!recipient && targetInvalid}
          />
        </label>
      )}
      <div className="composer-row">
        <select
          aria-label="Send channel"
          value={channel}
          onChange={(event) => {
            revision.current += 1;
            setChannel(event.target.value as SendChannel);
            setError("");
          }}
        >
          {SEND_CHANNELS.map((name) => (
            <option key={name} value={name}>
              {name === "ooc" ? "OOC" : name[0].toUpperCase() + name.slice(1)}
            </option>
          ))}
        </select>
        <textarea
          ref={input}
          rows={1}
          aria-label="Message"
          placeholder={connected ? "message" : "connect to send a message"}
          value={text}
          onChange={(event) => {
            revision.current += 1;
            setText(event.target.value);
            setError("");
          }}
          aria-invalid={!!invalid}
          aria-describedby={error || invalid ? "send-error" : undefined}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          className="icon-button send-button"
          type="submit"
          aria-label="Send message"
          title="Send message"
          disabled={!canSend}
          aria-busy={sending}
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
            aria-hidden="true"
          >
            <path d="m21 3-7 18-4-7-7-4 18-7Z" />
            <path d="m10 14 11-11" />
          </svg>
        </button>
      </div>
      {(error || invalid) && (
        <p id="send-error" className="composer-error" role="alert">
          {invalid || error}
        </p>
      )}
      {channel === "tell" && !!recipient && targetInvalid && (
        <p className="composer-error" role="alert">
          Enter a character name using letters only.
        </p>
      )}
    </form>
  );
}
