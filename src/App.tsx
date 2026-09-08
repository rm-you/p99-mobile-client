import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { CHANNELS, MAX_RECORDS, matchesChannel, recordText } from "./protocol";
import type {
  AppEvent,
  ChatRecord,
  ConnectRequest,
  SessionStatus,
} from "./protocol";
import "./App.css";

const initialSettings: ConnectRequest = {
  user: "",
  pass: "",
  character: "",
  server: "green",
};
const channelLabel = (name: string) =>
  name === "ooc" ? "OOC" : name.replace(/_/g, " ");

function MessageRow({ record }: { record: ChatRecord }) {
  const links = [
    ...(record.item_links ?? []),
    ...(record.arguments?.flatMap((argument) => argument.item_links ?? []) ??
      []),
  ];
  return (
    <article className={`message channel-${record.channel_name ?? "system"}`}>
      <div className="message-meta">
        <span className="channel-name">
          {channelLabel(record.channel_name ?? "system")}
        </span>
        <strong>
          {record.sender ||
            (record.type === "decode_error" ? "Notice" : "Norrath")}
        </strong>
        {record.target && <span className="recipient">to {record.target}</span>}
        <time dateTime={record.timestamp}>
          {new Date(record.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <p>{recordText(record)}</p>
      {links.length > 0 && (
        <div className="item-links">
          {links.map((link, index) => (
            <span
              className="item-link"
              key={`${link.item_id}-${index}`}
              title={`Item ${link.item_id} · ${link.body}`}
            >
              ◇ {link.text}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<"chat" | "settings">("settings");
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const activeRef = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const native = isTauri();

  const visible = records.filter(
    (record) =>
      matchesChannel(record, channel) &&
      `${record.sender ?? ""} ${recordText(record)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );

  async function disconnect() {
    if (!native || !activeRef.current) return;
    setStopping(true);
    try {
      await invoke("disconnect");
      activeRef.current = false;
      setActive(false);
      setStatus((previous) =>
        previous ? { ...previous, state: "stopped" } : null,
      );
    } catch {
      setError("Could not finish disconnecting. Please try again.");
    } finally {
      setStopping(false);
    }
  }

  useEffect(() => {
    const background = () => {
      if (document.hidden && native && activeRef.current) {
        setDiagnostic("Disconnected when the app moved to the background.");
        void disconnect();
      }
    };
    document.addEventListener("visibilitychange", background);
    return () => {
      document.removeEventListener("visibilitychange", background);
    };
  }, []);

  useEffect(() => {
    if (follow && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [records, channel, query, follow, tab]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!native || activeRef.current || stopping) return;
    const id = ++generation.current;
    setError("");
    setDiagnostic("");
    setStatus(null);
    setRecords([]);
    activeRef.current = true;
    setActive(true);
    const onEvent = new Channel<AppEvent>();
    onEvent.onmessage = (event) => {
      if (id !== generation.current) return;
      if (event.type === "finished") {
        activeRef.current = false;
        setActive(false);
        setStatus((previous) =>
          previous ? { ...previous, state: "stopped" } : null,
        );
        if (event.data.error) setError(event.data.error);
        return;
      }
      const message = event.data;
      switch (message.type) {
        case "status":
          setStatus(message.data);
          break;
        case "record":
          setRecords((previous) => [
            ...previous.slice(-(MAX_RECORDS - 1)),
            message.data,
          ]);
          break;
        case "diagnostic":
          setDiagnostic(message.data);
          break;
        case "reconnecting":
          setDiagnostic(
            `Connection ended: ${message.data.error}. Retrying in ${message.data.delay_seconds}s.`,
          );
          break;
      }
    };
    try {
      await invoke("connect", {
        request: {
          ...settings,
          user: settings.user.trim(),
          character: settings.character.trim(),
        },
        onEvent,
      });
      setSettings((previous) => ({ ...previous, pass: "" }));
      setTab("chat");
    } catch (failure) {
      activeRef.current = false;
      setActive(false);
      setError(
        typeof failure === "string"
          ? failure
          : "Unable to start the connection.",
      );
    }
  }

  const stateLabel = stopping
    ? "Disconnecting"
    : active
      ? status?.state === "connected"
        ? "Connected"
        : status?.state === "zoning"
          ? "Entering zone"
          : "Connecting"
      : "Offline";
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          ✦
        </div>
        <div>
          <h1>
            P99 <span>Mobile</span>
          </h1>
          <p>Your window into Norrath</p>
        </div>
        <span
          className={`connection-badge ${status?.state === "connected" && active ? "online" : ""}`}
        >
          <i />
          {stateLabel}
        </span>
      </header>
      <section className="character-bar">
        <div>
          <span className={`server-dot ${settings.server}`} />
          <strong>{settings.character || "No character selected"}</strong>
          <span className="server-name">{settings.server}</span>
        </div>
        <span>{status?.zone || "Select your character to begin"}</span>
      </section>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {!native && (
        <div className="notice preview">
          UI preview · Use the installed app to connect to P99.
        </div>
      )}

      {tab === "settings" ? (
        <section className="settings-view">
          <div className="section-heading">
            <span className="eyebrow">CONNECTION</span>
            <h2>Return to Norrath</h2>
            <p>
              Connect an existing character to read chat from their current
              zone.
            </p>
          </div>
          <form onSubmit={connect}>
            <fieldset disabled={active || stopping}>
              <legend>Choose your server</legend>
              <div className="server-picker">
                {(["green", "blue"] as const).map((server) => (
                  <button
                    className={settings.server === server ? "selected" : ""}
                    type="button"
                    key={server}
                    aria-pressed={settings.server === server}
                    onClick={() =>
                      setSettings((previous) => ({ ...previous, server }))
                    }
                  >
                    <span className={`server-dot ${server}`} />
                    P99 {server}
                  </button>
                ))}
              </div>
              <label>
                Login account
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  required
                  value={settings.user}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      user: event.target.value,
                    }))
                  }
                  placeholder="Your login server account"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={settings.pass}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      pass: event.target.value,
                    }))
                  }
                  placeholder={
                    active ? "In use for this session" : "Your login password"
                  }
                />
              </label>
              <label>
                Character name
                <input
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  maxLength={63}
                  value={settings.character}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      character: event.target.value,
                    }))
                  }
                  placeholder="Your character's name"
                />
              </label>
            </fieldset>
            {active ? (
              <button
                type="button"
                className="primary-button disconnect"
                disabled={stopping}
                onClick={() => void disconnect()}
              >
                {stopping ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={!native || stopping}
                type="submit"
              >
                Connect to character <span>→</span>
              </button>
            )}
          </form>
          <div className="quiet-note">
            <span>◇</span>
            <p>
              Credentials stay in memory for this session. This first version
              does not save your password. Keep the app open to stay connected.
            </p>
          </div>
        </section>
      ) : (
        <section className="chat-view">
          <div className="chat-toolbar">
            <h2>Conversation</h2>
            <span>{records.length.toLocaleString()} retained</span>
            <button
              className="text-button"
              type="button"
              onClick={() => setRecords([])}
              disabled={!records.length}
            >
              Clear
            </button>
          </div>
          <div className="channels" aria-label="Chat channel">
            {CHANNELS.map((name) => (
              <button
                key={name}
                type="button"
                className={channel === name ? "selected" : ""}
                aria-pressed={channel === name}
                onClick={() => setChannel(name)}
              >
                {channelLabel(name)}
              </button>
            ))}
          </div>
          <label className="search-label">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Search retained messages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages or players"
            />
          </label>
          <div
            className="messages"
            ref={list}
            aria-label="Game chat"
            onScroll={(event) => {
              const element = event.currentTarget;
              setFollow(
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                  60,
              );
            }}
          >
            {visible.length ? (
              visible.map((record) => (
                <MessageRow
                  key={`${record.session_id}-${record.message_id}`}
                  record={record}
                />
              ))
            ) : (
              <div className="empty-state">
                <div aria-hidden="true">✧</div>
                <h3>
                  {records.length
                    ? "No matching messages"
                    : active
                      ? "Listening to Norrath"
                      : "The conversation awaits"}
                </h3>
                <p>
                  {records.length
                    ? "Try another channel or search."
                    : active
                      ? "Incoming messages will appear here."
                      : "Connect your character to see live game chat."}
                </p>
                {!active && (
                  <button
                    className="text-button"
                    onClick={() => setTab("settings")}
                  >
                    Set up connection →
                  </button>
                )}
              </div>
            )}
          </div>
          {!follow && visible.length > 0 && (
            <button className="latest-button" onClick={() => setFollow(true)}>
              ↓ Latest messages
            </button>
          )}
          <div className="chat-footer">
            <span title={diagnostic}>
              {active
                ? diagnostic || "Waiting for server traffic…"
                : "Offline · Messages remain until cleared or the app closes"}
            </span>
            {active && (
              <button
                className="text-button"
                disabled={stopping}
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            )}
          </div>
        </section>
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className={tab === "chat" ? "selected" : ""}
          onClick={() => setTab("chat")}
        >
          <span aria-hidden="true">☷</span>Chat
        </button>
        <button
          className={tab === "settings" ? "selected" : ""}
          onClick={() => setTab("settings")}
        >
          <span aria-hidden="true">⚙</span>Connection
        </button>
      </nav>
    </main>
  );
}
