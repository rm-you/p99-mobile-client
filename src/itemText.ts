import type { ItemLink, Message } from "./protocol";

export interface TextPart {
  text: string;
  link?: ItemLink;
}

/** Convert decoder-provided UTF-8 byte ranges without searching for item names. */
export function itemText(message: Message): {
  parts: TextPart[];
  remaining: ItemLink[];
} {
  const bytes = new TextEncoder().encode(message.text);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: TextPart[] = [];
  const remaining: ItemLink[] = [];
  let cursor = 0;
  for (const link of message.item_links ?? []) {
    const start = link.text_start,
      end = link.text_end;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < cursor ||
      end <= start ||
      end > bytes.length
    ) {
      remaining.push(link);
      continue;
    }
    try {
      const prefix = decoder.decode(bytes.slice(cursor, start));
      const label = decoder.decode(bytes.slice(start, end));
      if (label !== link.text) {
        remaining.push(link);
        continue;
      }
      if (prefix) parts.push({ text: prefix });
      parts.push({ text: label, link });
      cursor = end;
    } catch {
      remaining.push(link);
    }
  }
  if (cursor < bytes.length)
    parts.push({ text: decoder.decode(bytes.slice(cursor)) });
  return { parts, remaining };
}
