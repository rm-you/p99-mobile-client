import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatRecord } from "./protocol";
import { recordChannel } from "./protocol";
import { incomingMessage, recordKey } from "./chatTools";

/** Only live incoming messages become unread; history starts as already read. */
export default function useUnread(
  records: ChatRecord[],
  visible: ChatRecord[],
  readingLatest: boolean,
) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [boundary, setBoundary] = useState<string | null>(null);
  const add = useCallback((record: ChatRecord) => {
    if (!incomingMessage(record)) return;
    const key = recordKey(record);
    setKeys((previous) => new Set(previous).add(key));
    setBoundary((previous) => previous ?? key);
  }, []);
  const read = useCallback((readKeys: string[]) => {
    setKeys((previous) => {
      if (!readKeys.some((key) => previous.has(key))) return previous;
      const next = new Set(previous);
      readKeys.forEach((key) => next.delete(key));
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setKeys(new Set());
    setBoundary(null);
  }, []);
  useEffect(() => {
    const retained = new Set(records.map(recordKey));
    setKeys((previous) =>
      [...previous].some((key) => !retained.has(key))
        ? new Set([...previous].filter((key) => retained.has(key)))
        : previous,
    );
  }, [records]);
  useEffect(() => {
    if (readingLatest) read(visible.map(recordKey));
  }, [visible, readingLatest, read]);
  // Start a fresh last-read boundary whenever the user leaves the bottom.
  useEffect(() => {
    if (!readingLatest) setBoundary(null);
  }, [readingLatest]);
  const unread = useMemo(
    () => records.filter((r) => keys.has(recordKey(r))),
    [records, keys],
  );
  return {
    add,
    read,
    reset,
    boundary: boundary ?? (unread[0] ? recordKey(unread[0]) : null),
    count: unread.length,
    tells: unread.filter((r) => recordChannel(r) === "tell").length,
  };
}
