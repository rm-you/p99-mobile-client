import { Fragment } from "react";
import { itemText } from "./itemText";
import { recordChannel, recordText } from "./protocol";
import type { ChatRecord, ItemLink, Message } from "./protocol";
import { replyRecipient } from "./composer";
import { isOwnMessage, recordKey } from "./chatTools";
import SwipeToReply from "./SwipeToReply";
import MessageDelivery from "./MessageDelivery";
import type { Submission } from "./chatTools";

function LinkedText({
  message,
  onItem,
}: {
  message: Message;
  onItem: (item: ItemLink) => void;
}) {
  const { parts, remaining } = itemText(message);
  return (
    <>
      {parts.map((part, index) =>
        part.link ? (
          <button
            key={index}
            type="button"
            className="inline-item-link"
            onClick={() => onItem(part.link!)}
          >
            {part.text}
          </button>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
      {remaining.length > 0 && (
        <span className="item-links">
          {remaining.map((link, index) => (
            <button
              className="item-link"
              key={index}
              type="button"
              onClick={() => onItem(link)}
            >
              {link.text}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

export default function MessageRow({
  record,
  onItem,
  onReply,
  onActions,
  delivery,
}: {
  record: ChatRecord;
  onItem: (item: ItemLink) => void;
  onReply?: (recipient: string) => void;
  onActions?: (record: ChatRecord) => void;
  delivery?: Submission["state"];
}) {
  const channel = recordChannel(record);
  const recipient = onReply ? replyRecipient(record) : null;
  const content = (
    <article
      data-message-key={recordKey(record)}
      className={`message channel-${channel}`}
    >
      <div className="message-meta">
        <span className="channel-name">
          {channel === "ooc" ? "OOC" : channel.replace(/_/g, " ")}
        </span>
        <strong>
          {(isOwnMessage(record) ? "You" : record.sender) ||
            (record.type === "decode_error" ? "Notice" : "Norrath")}
        </strong>
        {record.target && <span className="recipient">to {record.target}</span>}
        {onActions && (
          <button
            type="button"
            className="sr-only message-access"
            aria-label={`Actions for ${record.sender || "game"} message`}
            onClick={() => onActions(record)}
          >
            Message actions
          </button>
        )}
        <time dateTime={record.timestamp}>
          {new Date(record.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <div className="message-body">
        <div className="message-text">
          {record.type === "decode_error" ? (
            recordText(record)
          ) : record.text !== undefined ? (
            <LinkedText
              message={{ text: record.text, item_links: record.item_links }}
              onItem={onItem}
            />
          ) : record.arguments?.length ? (
            <>
              {record.string_id !== undefined
                ? `Game message #${record.string_id}: `
                : ""}
              {record.arguments.map((argument, index) => (
                <Fragment key={index}>
                  {index > 0 && " · "}
                  <LinkedText message={argument} onItem={onItem} />
                </Fragment>
              ))}
            </>
          ) : (
            recordText(record)
          )}
        </div>
        {delivery && <MessageDelivery state={delivery} />}
      </div>
    </article>
  );
  return (
    <SwipeToReply
      onReply={recipient ? () => onReply?.(recipient) : undefined}
      onLongPress={onActions ? () => onActions(record) : undefined}
    >
      {content}
    </SwipeToReply>
  );
}
