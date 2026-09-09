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
interface SavedSettings {
  version: number;
  server: ConnectRequest["server"];
  character: string;
  channel: string;
  follow: boolean;
}
interface VaultStatus {
  available: boolean;
  saved: boolean;
}
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
  const [ready, setReady] = useState(false);
  const [persist, setPersist] = useState(false);
  const [vault, setVault] = useState<VaultStatus>({
    available: false,
    saved: false,
  });
  const [useSaved, setUseSaved] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const vaultBusyRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
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

  useEffect(() => {
    if (!native) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void Promise.allSettled([
      invoke<SavedSettings>("load_settings"),
      invoke<VaultStatus>("credential_status"),
    ]).then(([preferences, credentials]) => {
      if (cancelled) return;
      if (preferences.status === "fulfilled") {
        const value = preferences.value;
        setSettings((previous) => ({
          ...previous,
          server: value.server,
          character: value.character,
        }));
        setChannel(value.channel);
        setFollow(value.follow);
        setPersist(true);
      } else
        setError(
          "Saved settings could not be loaded. Changes will not be saved this time.",
        );
      if (credentials.status === "fulfilled") {
        setVault(credentials.value);
        setUseSaved(credentials.value.saved);
      } else
        setError(
          "Saved login could not be checked. You can still enter your credentials manually.",
        );
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [native]);

  // Persist only an explicit allowlist of nonsecret preferences. Serial writes
  // prevent an older asynchronous save from winning over a newer selection.
  useEffect(() => {
    if (!native || !ready || !persist) return;
    const timer = setTimeout(() => {
      const preferences: SavedSettings = {
        version: 1,
        server: settings.server,
        character: settings.character,
        channel,
        follow,
      };
      saveQueue.current = saveQueue.current
        .then(() => invoke<void>("save_settings", { settings: preferences }))
        .catch(() => {
          setError(
            "Settings could not be saved. Your current connection is unaffected.",
          );
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    native,
    ready,
    persist,
    settings.server,
    settings.character,
    channel,
    follow,
  ]);

  async function changeSavedLogin(action: "save" | "forget") {
    if (!native || vaultBusyRef.current || activeRef.current) return;
    vaultBusyRef.current = true;
    setVaultBusy(true);
    setError("");
    try {
      if (action === "save") {
        await invoke("save_credentials", {
          credentials: { user: settings.user.trim(), pass: settings.pass },
        });
        setVault((previous) => ({ ...previous, saved: true }));
        setUseSaved(true);
      } else {
        await invoke("forget_credentials");
        setVault((previous) => ({ ...previous, saved: false }));
        setUseSaved(false);
      }
      setSettings((previous) => ({ ...previous, user: "", pass: "" }));
    } catch {
      setError(
        action === "save"
          ? "Login was not saved. Unlock your device and try again."
          : "Could not forget the saved login. Try again.",
      );
    } finally {
      vaultBusyRef.current = false;
      setVaultBusy(false);
    }
  }

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
    if (follow && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [records, channel, query, follow, tab]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (
      !native ||
      !ready ||
      activeRef.current ||
      stopping ||
      vaultBusyRef.current
    )
      return;
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
      if (useSaved)
        await invoke("connect_saved", {
          server: settings.server,
          character: settings.character.trim(),
          onEvent,
        });
      else
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
            <fieldset disabled={active || stopping || vaultBusy || !ready}>
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
              {useSaved ? (
                <div className="saved-login">
                  <strong>Saved login is locked</strong>
                  <p>Unlock with your device when you connect.</p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setUseSaved(false)}
                  >
                    Use different login
                  </button>
                </div>
              ) : (
                <>
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
                        active
                          ? "In use for this session"
                          : "Your login password"
                      }
                    />
                  </label>
                  {vault.available && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!settings.user.trim() || !settings.pass}
                      onClick={() => void changeSavedLogin("save")}
                    >
                      {vaultBusy
                        ? "Saving…"
                        : vault.saved
                          ? "Replace saved login securely"
                          : "Save login securely"}
                    </button>
                  )}
                  {!vault.available && (
                    <p className="storage-hint">
                      To save a login, enable a device lock on Android 11+ or
                      iOS, or enroll a strong biometric on older Android
                      versions. You can also connect without saving.
                    </p>
                  )}
                  {vault.saved && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setUseSaved(true);
                        setSettings((previous) => ({
                          ...previous,
                          user: "",
                          pass: "",
                        }));
                      }}
                    >
                      Use saved login
                    </button>
                  )}
                </>
              )}
              {vault.saved && (
                <button
                  type="button"
                  className="text-button forget-login"
                  onClick={() => void changeSavedLogin("forget")}
                >
                  Forget saved login
                </button>
              )}
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
                disabled={!native || stopping || vaultBusy || !ready}
                type="submit"
              >
                {!ready
                  ? "Loading settings…"
                  : useSaved
                    ? "Unlock and connect"
                    : "Connect to character"}{" "}
                <span>→</span>
              </button>
            )}
          </form>
          <div className="quiet-note">
            <span>◇</span>
            <p>
              Settings are saved on this device. Saving your login is optional
              and uses your device’s secure storage. The active session can
              reconnect without unlocking again. We try to stay connected in the
              background, but your phone may pause or stop the app.
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
