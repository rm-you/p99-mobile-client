import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  CHANNELS,
  MAX_RECORDS,
  matchesChannels,
  recordText,
  isEmptyGuildMotd,
} from "./protocol";
import type {
  AppEvent,
  ChatRecord,
  ConnectRequest,
  SessionStatus,
  ItemLink,
  ChatChannel,
} from "./protocol";
import "./App.css";
import SavedProfiles, { profileLabel } from "./SavedProfiles";
import type { SavedProfile, VaultStatus } from "./SavedProfiles";
import ConfirmDialog from "./ConfirmDialog";
import ItemModal from "./ItemModal";
import MessageRow from "./MessageRow";
import { connectionDisplay } from "./connection";
import { zoneName } from "./zones";

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
  channels: ChatChannel[];
  follow: boolean;
}
const channelLabel = (name: string) =>
  name === "ooc" ? "OOC" : name.replace(/_/g, " ");

export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [ready, setReady] = useState(false);
  const [persist, setPersist] = useState(false);
  const [vault, setVault] = useState<VaultStatus>({
    available: false,
    profiles: [],
    legacySaved: false,
  });
  const [editing, setEditing] = useState<SavedProfile | "legacy" | null>(null);
  const [sessionIdentity, setSessionIdentity] = useState<Pick<
    SavedProfile,
    "character" | "server"
  > | null>(null);
  const [confirmation, setConfirmation] = useState<
    "disconnect" | "legacy" | SavedProfile | null
  >(null);
  const [pendingLogin, setPendingLogin] = useState<ConnectRequest | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const vaultBusyRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const [tab, setTab] = useState<"chat" | "settings">("settings");
  const [selectedItem, setSelectedItem] = useState<ItemLink | null>(null);
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [channels, setChannels] = useState<ChatChannel[]>([...CHANNELS]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const activeRef = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const native = isTauri();

  useEffect(() => {
    if (!active) return;
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active]);

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
        setChannels(value.channels);
        setFollow(value.follow);
        setPersist(true);
      } else
        setError(
          "Saved settings could not be loaded. Changes will not be saved this time.",
        );
      if (credentials.status === "fulfilled") {
        setVault(credentials.value);
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
        version: 2,
        server: settings.server,
        character: settings.character,
        channels,
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
    channels,
    follow,
  ]);

  function editProfile(profile: SavedProfile | "legacy" | null) {
    setEditing(profile);
    setSettings((previous) => ({
      ...previous,
      user: "",
      pass: "",
      ...(profile && profile !== "legacy"
        ? { character: profile.character, server: profile.server }
        : {}),
    }));
    setError("");
  }

  async function saveProfile(connectionLogin?: ConnectRequest) {
    if (
      !native ||
      vaultBusyRef.current ||
      (activeRef.current && !connectionLogin)
    )
      return;
    vaultBusyRef.current = true;
    setVaultBusy(true);
    setError("");
    const input = connectionLogin ?? settings;
    const matching =
      connectionLogin &&
      vault.profiles.find(
        (profile) =>
          profile.server === connectionLogin.server &&
          profile.character.toLowerCase() ===
            connectionLogin.character.toLowerCase(),
      );
    try {
      const profile = await invoke<SavedProfile>("save_profile", {
        request: {
          id: connectionLogin
            ? matching
              ? matching.id
              : null
            : editing === "legacy"
              ? "legacy"
              : (editing?.id ?? null),
          character: input.character.trim(),
          server: input.server,
          user: input.user.trim(),
          pass: input.pass,
        },
      });
      setVault((previous) => ({
        ...previous,
        profiles: [
          ...previous.profiles.filter((p) => p.id !== profile.id),
          profile,
        ],
      }));
      if (!connectionLogin) editProfile(null);
      else setSettings((previous) => ({ ...previous, user: "", pass: "" }));
      // Refresh migration status only after the new protected entry is durable.
      try {
        setVault(await invoke<VaultStatus>("credential_status"));
      } catch {
        setError("Character saved. Restart the app later to refresh the list.");
      }
    } catch (failure) {
      setError(
        typeof failure === "string"
          ? failure
          : "Character was not saved. Unlock your device and try again.",
      );
    } finally {
      vaultBusyRef.current = false;
      setVaultBusy(false);
    }
  }

  async function deleteProfile(profile: SavedProfile | "legacy") {
    if (!native || vaultBusyRef.current || activeRef.current) return;
    vaultBusyRef.current = true;
    setVaultBusy(true);
    setError("");
    try {
      if (profile === "legacy") await invoke("forget_legacy");
      else await invoke("forget_profile", { id: profile.id });
      setVault((previous) =>
        profile === "legacy"
          ? { ...previous, legacySaved: false }
          : {
              ...previous,
              profiles: previous.profiles.filter((p) => p.id !== profile.id),
            },
      );
      if (
        editing === profile ||
        (editing &&
          editing !== "legacy" &&
          profile !== "legacy" &&
          editing.id === profile.id)
      )
        editProfile(null);
    } catch {
      setError("Could not delete the saved character. Try again.");
    } finally {
      vaultBusyRef.current = false;
      setVaultBusy(false);
    }
  }

  const visible = records.filter(
    (record) =>
      matchesChannels(record, channels) &&
      `${record.sender ?? ""} ${recordText(record)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );

  async function disconnect() {
    if (!native || !activeRef.current) return;
    setStopping(true);
    try {
      setPendingLogin(null);
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
  }, [records, channels, query, follow, tab, filtersOpen]);

  async function connect(profile?: SavedProfile) {
    if (
      !native ||
      !ready ||
      activeRef.current ||
      stopping ||
      vaultBusyRef.current
    )
      return;
    const request = {
      ...settings,
      user: settings.user.trim(),
      character: settings.character.trim(),
    };
    const id = ++generation.current;
    setError("");
    setRetrying(false);
    setNow(Date.now());
    setStatus(null);
    setSessionIdentity(
      profile ?? {
        character: settings.character.trim(),
        server: settings.server,
      },
    );
    setRecords([]);
    activeRef.current = true;
    setActive(true);
    const onEvent = new Channel<AppEvent>();
    onEvent.onmessage = (event) => {
      if (id !== generation.current) return;
      if (event.type === "finished") {
        setPendingLogin(null);
        activeRef.current = false;
        setActive(false);
        setStatus((previous) =>
          previous ? { ...previous, state: "stopped" } : null,
        );
        if (event.data.error)
          setError("Connection ended. Please try connecting again.");
        return;
      }
      const message = event.data;
      switch (message.type) {
        case "status":
          setStatus(message.data);
          setNow(Date.now());
          setRetrying(false);
          break;
        case "record":
          if (isEmptyGuildMotd(message.data)) break;
          setRecords((previous) => [
            ...previous.slice(-(MAX_RECORDS - 1)),
            message.data,
          ]);
          break;
        case "diagnostic":
          // Transport details are not user-facing connection progress.
          break;
        case "reconnecting":
          setRetrying(true);
          break;
      }
    };
    try {
      if (profile) {
        const saved = await invoke<SavedProfile>("connect_saved", {
          id: profile.id,
          onEvent,
        });
        setSessionIdentity(saved);
      } else
        await invoke("connect", {
          request,
          onEvent,
        });
      setSettings((previous) => ({ ...previous, pass: "" }));
      setTab("chat");
      if (!profile && vault.available && activeRef.current)
        setPendingLogin(request);
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

  function submitConnection(event: FormEvent) {
    event.preventDefault();
    if (editing) void saveProfile();
    else void connect();
  }
  const credentialsComplete = !!settings.user.trim() && !!settings.pass;
  const canSave =
    !!settings.character.trim() &&
    (credentialsComplete || (!!editing && !settings.user && !settings.pass));
  const disabled = active || stopping || vaultBusy || !ready;
  const connection = connectionDisplay(active, stopping, status, retrying, now);
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-title">
          <h1>P99 Mobile</h1>
          {tab === "chat" && sessionIdentity?.character && (
            <p className="session-context">
              {sessionIdentity.character} · P99{" "}
              {sessionIdentity.server === "green" ? "Green" : "Blue"}
              {status?.zone ? ` · ${zoneName(status.zone)}` : ""}
            </p>
          )}
        </div>
        <span
          className={`connection-status ${connection.healthy ? "online" : ""}`}
        >
          {connection.label}
        </span>
      </header>
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
          <h2>Connection</h2>
          <SavedProfiles
            vault={vault}
            disabled={disabled}
            onConnect={(profile) => void connect(profile)}
            onEdit={editProfile}
            onDelete={setConfirmation}
          />
          <form onSubmit={submitConnection}>
            <h3 className="manual-heading">
              {editing ? "Edit saved character" : "Manual connection"}
            </h3>
            <fieldset disabled={active || stopping || vaultBusy || !ready}>
              <label>
                Login account
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  required={!editing}
                  value={settings.user}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      user: event.target.value,
                    }))
                  }
                  placeholder={
                    editing
                      ? "Leave blank to keep saved login"
                      : "Your login server account"
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required={!editing}
                  value={settings.pass}
                  onChange={(event) =>
                    setSettings((previous) => ({
                      ...previous,
                      pass: event.target.value,
                    }))
                  }
                  placeholder={
                    editing
                      ? "Leave blank to keep saved password"
                      : active
                        ? "In use for this session"
                        : "Your login password"
                  }
                />
              </label>
              <span className="server-label" id="server-label">
                Server
              </span>
              <div
                className="server-picker"
                role="group"
                aria-labelledby="server-label"
              >
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
                    P99 {server}
                  </button>
                ))}
              </div>
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
              {editing && (
                <p className="storage-hint">
                  Leave both account and password blank to keep the saved login.
                </p>
              )}
              {!vault.available && (
                <p className="storage-hint">
                  Enable a supported device lock or biometric to save your
                  login. You can also connect without saving.
                </p>
              )}
              {editing && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editProfile(null)}
                >
                  Cancel editing
                </button>
              )}
            </fieldset>
            {active ? (
              <button
                type="button"
                className="primary-button disconnect"
                disabled={stopping}
                onClick={() => setConfirmation("disconnect")}
              >
                {stopping ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  !native ||
                  stopping ||
                  vaultBusy ||
                  !ready ||
                  (!!editing && (!canSave || !vault.available))
                }
                type="submit"
              >
                {!ready
                  ? "Loading settings…"
                  : editing
                    ? "Save changes"
                    : "Connect to character"}
              </button>
            )}
          </form>
          <p className="settings-note">
            Settings save automatically. Saving your login is optional. Your
            phone may pause connections in the background.
          </p>
        </section>
      ) : (
        <section className="chat-view">
          <div className="chat-toolbar">
            <h2>Chat</h2>
            <span>{records.length.toLocaleString()} messages</span>
            <button
              className="text-button"
              type="button"
              onClick={() => setRecords([])}
              disabled={!records.length}
            >
              Clear
            </button>
          </div>
          <details
            className="chat-filters"
            open={filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              Filters
              {channels.length !== CHANNELS.length || query ? " · Active" : ""}
            </summary>
            <fieldset className="channel-filters">
              <legend className="sr-only">Chat channels</legend>
              <div className="channel-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setChannels([...CHANNELS])}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setChannels([])}
                >
                  None
                </button>
              </div>
              <div className="channel-options">
                {CHANNELS.map((name) => (
                  <label
                    key={name}
                    className={`channel-toggle channel-${name}`}
                  >
                    <input
                      type="checkbox"
                      checked={channels.includes(name)}
                      onChange={(event) =>
                        setChannels((previous) =>
                          event.target.checked
                            ? CHANNELS.filter(
                                (channel) =>
                                  channel === name ||
                                  previous.includes(channel),
                              )
                            : previous.filter((channel) => channel !== name),
                        )
                      }
                    />
                    {channelLabel(name)}
                  </label>
                ))}
              </div>
            </fieldset>
            <input
              type="search"
              aria-label="Search retained messages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages"
            />
          </details>
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
                  onItem={setSelectedItem}
                />
              ))
            ) : (
              <div className="empty-state">
                <h3>
                  {!channels.length
                    ? "No channels selected"
                    : records.length
                      ? "No matching messages"
                      : active
                        ? "Waiting for messages"
                        : "No messages yet"}
                </h3>
                <p>
                  {!channels.length
                    ? "Open Filters to choose which channels to show."
                    : records.length
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
                    Set up connection
                  </button>
                )}
              </div>
            )}
          </div>
          {!follow && visible.length > 0 && (
            <button className="latest-button" onClick={() => setFollow(true)}>
              Latest messages
            </button>
          )}
        </section>
      )}
      {(active || status) && (
        <div
          className={`chat-footer ${connection.busy ? "connection-progress" : ""}`}
        >
          <span role="status" aria-label="Connection health">
            {connection.detail}
          </span>
          {active && tab === "chat" && (
            <button
              className="text-button"
              disabled={stopping}
              onClick={() => setConfirmation("disconnect")}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
      {pendingLogin && (
        <ConfirmDialog
          title={
            vault.profiles.some(
              (profile) =>
                profile.server === pendingLogin.server &&
                profile.character.toLowerCase() ===
                  pendingLogin.character.toLowerCase(),
            )
              ? "Update saved login?"
              : "Save this character?"
          }
          description={`Save ${pendingLogin.character} on P99 ${pendingLogin.server === "green" ? "Green" : "Blue"} with this account and password for next time? Your connection will continue either way.`}
          confirm="Save"
          cancel="Not now"
          onCancel={() => setPendingLogin(null)}
          onConfirm={() => {
            const login = pendingLogin;
            setPendingLogin(null);
            void saveProfile(login);
          }}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation === "disconnect"
              ? "Disconnect from P99?"
              : "Delete saved login?"
          }
          description={
            confirmation === "disconnect"
              ? "Your character will leave the game. You can connect again whenever you're ready."
              : confirmation === "legacy"
                ? "Remove the previous saved account and password from this device?"
                : `Remove ${profileLabel(confirmation)} and its saved login from this device?`
          }
          confirm={confirmation === "disconnect" ? "Disconnect" : "Delete"}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation;
            setConfirmation(null);
            if (action === "disconnect") void disconnect();
            else void deleteProfile(action);
          }}
        />
      )}
      {selectedItem && (
        <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className={tab === "chat" ? "selected" : ""}
          aria-current={tab === "chat" ? "page" : undefined}
          onClick={() => setTab("chat")}
        >
          Chat
        </button>
        <button
          className={tab === "settings" ? "selected" : ""}
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => setTab("settings")}
        >
          Connection
        </button>
      </nav>
    </main>
  );
}
