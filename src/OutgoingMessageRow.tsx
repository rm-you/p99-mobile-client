import type { Submission } from "./chatTools";
import MessageDelivery from "./MessageDelivery";

/** Show a local attempt until its server record replaces it; never save it as received chat. */
export default function OutgoingMessageRow({
  submission,
}: {
  submission: Submission;
}) {
  const { message, at, state } = submission;
  return (
    <article className={`message channel-${message.channel}`}>
      <div className="message-meta">
        <span className="channel-name">
          {message.channel === "ooc" ? "OOC" : message.channel}
        </span>
        <strong>You</strong>
        {message.channel === "tell" && (
          <span className="recipient">to {message.recipient}</span>
        )}
        <time dateTime={new Date(at).toISOString()}>
          {new Date(at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <div className="message-body">
        <div className="message-text">{message.text}</div>
        <MessageDelivery state={state} />
      </div>
    </article>
  );
}
