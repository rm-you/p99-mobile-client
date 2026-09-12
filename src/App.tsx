import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  CHANNELS,
  SERVERS,
  serverLabel,
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
  ConnectionStage,
} from "./protocol";
import "./App.css";
import SavedProfiles, { profileLabel } from "./SavedProfiles";
import type { SavedProfile, VaultStatus } from "./SavedProfiles";
import ConfirmDialog from "./ConfirmDialog";
import ItemModal from "./ItemModal";
import MessageRow from "./MessageRow";
import OutgoingMessageRow from "./OutgoingMessageRow";
import ChatComposer from "./ChatComposer";
import type { OutgoingMessage, ReplySelection } from "./composer";
import { connectionDisplay } from "./connection";
import { zoneName } from "./zones";
import Preferences from "./Preferences";
import MessageActions from "./MessageActions";
import { defaultExperience } from "./experience";
import type { Experience, HistoryOwner } from "./experience";
import {
  applyEcho,
  coalesceSelfTells,
  isSelfTell,
  matchesSubmission,
  recordKey,
} from "./chatTools";
import type { Submission } from "./chatTools";
import useUnread from "./useUnread";
interface TimelineEntry {
  id: number;
  at: number;
  text: string;
}

type ChatEntry =
  | { kind: "message"; at: number; record: ChatRecord; submission?: Submission }
  | { kind: "outgoing"; at: number; submission: Submission }
  | { kind: "marker"; at: number; marker: TimelineEntry };

const initialSettings: ConnectRequest = {
  user: "",
  pass: "",
  character: "",
  server: "green",
};
interface SavedSettings {
  version: number;
  server: ConnectRequest["server"];
  channels: ChatChannel[];
  follow: boolean;
  experience?: Experience;
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
  const [tab, setTab] = useState<"chat" | "settings" | "preferences">(
    "settings",
  );
  const [selectedItem, setSelectedItem] = useState<ItemLink | null>(null);
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [channels, setChannels] = useState<ChatChannel[]>([...CHANNELS]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [stage, setStage] = useState<ConnectionStage>("connecting_login");
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [backgroundNotice, setBackgroundNotice] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<ReplySelection | null>(null);
  const generation = useRef(0);
  const activeRef = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const [experience, setExperience] = useState<Experience>(defaultExperience);
  const [selectedMessage, setSelectedMessage] = useState<ChatRecord | null>(
    null,
  );
  const [foreground, setForeground] = useState(
    document.visibilityState === "visible",
  );
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const submissionId = useRef(0);
  const lastMessage = useRef(0);
  const lastSession = useRef("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const timelineId = useRef(0);
  const lostConnection = useRef(false);
  const experienceRef = useRef(experience);
  experienceRef.current = experience;
  const muted = (record: ChatRecord) =>
    experience.muted_authors.some(
      (name) => name.toLowerCase() === record.sender?.toLowerCase(),
    );
  const attempts = useMemo(
    () => submissions.filter((s) => s.state !== "echoed"),
    [submissions],
  );
  const receipts = useMemo(
    () =>
      new Map(
        submissions.flatMap((s) =>
          s.echoKey ? [[s.echoKey, s] as const] : [],
        ),
      ),
    [submissions],
  );
  const displayedRecords = useMemo(
    () =>
      coalesceSelfTells(records).filter(
        (record) =>
          !(
            isSelfTell(record) &&
            record.channel === 7 &&
            attempts.some(
              (s) => s.state !== "failed" && matchesSubmission(s, record),
            )
          ),
      ),
    [records, attempts],
  );
  const messageCount = displayedRecords.length + attempts.length;
  const visible = useMemo(
    () =>
      displayedRecords.filter(
        (record) =>
          !experience.muted_authors.some(
            (name) => name.toLowerCase() === record.sender?.toLowerCase(),
          ) &&
          matchesChannels(record, channels) &&
          `${record.sender ?? ""} ${recordText(record)}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [displayedRecords, channels, query, experience.muted_authors],
  );
  const entries = useMemo(
    (): ChatEntry[] =>
      [
        ...visible.map((record): ChatEntry => {
          const submission = receipts.get(recordKey(record));
          return {
            kind: "message",
            at: submission?.at ?? Date.parse(record.timestamp),
            record,
            submission,
          };
        }),
        ...attempts
          .filter(
            (s) =>
              channels.includes(s.message.channel) &&
              `${sessionIdentity?.character ?? ""} ${s.message.text}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
          )
          .map((submission): ChatEntry => ({
            kind: "outgoing",
            at: submission.at,
            submission,
          })),
        ...timeline.map((marker): ChatEntry => ({
          kind: "marker",
          at: marker.at,
          marker,
        })),
      ].sort((a, b) => a.at - b.at),
    [visible, receipts, attempts, channels, query, sessionIdentity, timeline],
  );
  const unmutedRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          !experience.muted_authors.some(
            (name) => name.toLowerCase() === record.sender?.toLowerCase(),
          ),
      ),
    [records, experience.muted_authors],
  );
  const unread = useUnread(
    unmutedRecords,
    visible,
    foreground && tab === "chat" && follow,
  );
  const addUnread = unread.add;
  const reading = useRef(false);
  const displayed = useRef<(record: ChatRecord) => boolean>(() => true);
  displayed.current = (record) =>
    matchesChannels(record, channels) &&
    `${record.sender ?? ""} ${recordText(record)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  reading.current = foreground && tab === "chat" && follow;
  function addMarker(text: string) {
    const entry = { id: ++timelineId.current, at: Date.now(), text };
    setTimeline((previous) => [...previous.slice(-99), entry]);
  }
  function chooseReply(recipient: string) {
    setReply((previous) => ({
      recipient,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  }
  function clearView() {
    setRecords([]);
    setSubmissions([]);
    setTimeline([]);
    unread.reset();
  }
  async function viewHistory(owner: HistoryOwner) {
    if (activeRef.current) return;
    const id = ++generation.current;
    const loaded = await invoke<ChatRecord[]>("load_history", {
      owner: { server: owner.server, character: owner.character },
    });
    if (id !== generation.current || activeRef.current) return;
    setSessionIdentity({ server: owner.server, character: owner.character });
    setRecords(loaded);
    unread.reset();
    setTimeline([]);
    setSubmissions([]);
    setStatus(null);
    setReply(null);
    setFollow(true);
    setTab("chat");
  }
  useEffect(() => {
    const update = () => setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const pending = submissions.filter((s) => s.state === "submitted");
    if (!pending.length) return;
    const wait = Math.max(
      1,
      Math.min(...pending.map((s) => s.at + 15000)) - Date.now(),
    );
    const timer = setTimeout(
      () =>
        setSubmissions((previous) =>
          previous.map((s) =>
            s.state === "submitted" && Date.now() - s.at >= 15000
              ? { ...s, state: "unconfirmed" }
              : s,
          ),
        ),
      wait,
    );
    return () => clearTimeout(timer);
  }, [submissions]);
  useEffect(() => {
    if (
      !foreground ||
      tab !== "chat" ||
      !list.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) =>
        unread.read(
          entries
            .filter((e) => e.isIntersecting)
            .map((e) => (e.target as HTMLElement).dataset.messageKey!),
        ),
      { root: list.current, threshold: 0.5 },
    );
    list.current
      .querySelectorAll("[data-message-key]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [foreground, tab, visible, unread.read]);

  useEffect(() => {
    if (!native) return;
    const visibility = () => {
      void invoke("set_chat_visible", {
        visible: document.visibilityState === "visible",
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    // A WebView reload can leave native delivery paused without a new resume event.
    visibility();
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [native]);

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
        }));
        setChannels(value.channels);
        setFollow(value.follow);
        setExperience({ ...defaultExperience, ...value.experience });
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
        channels,
        follow,
        experience,
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
  }, [native, ready, persist, settings.server, channels, follow, experience]);

  function editProfile(profile: SavedProfile | "legacy" | null) {
    setEditing(profile);
    setSettings((previous) => ({
      ...previous,
      user: "",
      pass: "",
      character: "",
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

  async function disconnect() {
    if (!native || !activeRef.current) return;
    setStopping(true);
    try {
      setPendingLogin(null);
      await invoke("disconnect");
      activeRef.current = false;
      setActive(false);
      addMarker(
        "Disconnected. Messages received while offline are unavailable.",
      );
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
  }, [records, submissions, channels, query, follow, tab, filtersOpen]);

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
    setReply(null);
    unread.reset();
    setTimeline([]);
    setSubmissions([]);
    lastMessage.current = 0;
    lostConnection.current = false;
    setBackgroundNotice("");
    setError("");
    setRetrying(false);
    setNow(Date.now());
    setStatus(null);
    setStage("connecting_login");
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
      if (event.type === "history_error") {
        setError(
          "Chat history could not be saved. Live chat is still available.",
        );
        return;
      }
      if (event.type === "background") {
        setBackgroundNotice(
          !event.data.supported
            ? ""
            : !event.data.active
              ? "Background support is unavailable. Keep the app open for this session."
              : !event.data.notifications_enabled
                ? "Notifications are disabled. Enable them in Android settings to see background connection controls."
                : "",
        );
        return;
      }
      if (event.type === "finished") {
        addMarker("Connection ended. There may be a gap in messages.");
        setSubmissions((previous) =>
          previous.map((s) =>
            s.state === "submitting" || s.state === "submitted"
              ? { ...s, state: "unconfirmed" }
              : s,
          ),
        );
        setBackgroundNotice("");
        setPendingLogin(null);
        activeRef.current = false;
        setActive(false);
        setStatus((previous) =>
          previous ? { ...previous, state: "stopped" } : null,
        );
        if (event.data.error === "invalid_credentials") {
          setRetrying(false);
          setTab("settings");
          setError(
            "The login account or password was rejected. Check your login details and try again.",
          );
        } else if (event.data.error) {
          setError("Connection ended. Please try connecting again.");
        }
        return;
      }
      const message = event.data;
      switch (message.type) {
        case "status":
          if (message.data.session_id !== lastSession.current) {
            lastSession.current = message.data.session_id;
            lastMessage.current = 0;
          }
          if (message.data.state === "connected" && lostConnection.current) {
            addMarker(
              "Reconnected. Messages during the interruption may be missing.",
            );
            lostConnection.current = false;
          }
          if (message.data.state === "connecting") setStage("connecting_login");
          setStatus(message.data);
          setNow(Date.now());
          setRetrying(false);
          break;
        case "progress":
          setStage(message.data);
          break;
        case "record":
          if (isEmptyGuildMotd(message.data)) break;
          lastMessage.current = message.data.message_id;
          setSubmissions((previous) => applyEcho(previous, message.data));
          if (
            (!reading.current || !displayed.current(message.data)) &&
            !experienceRef.current.muted_authors.some(
              (name) =>
                name.toLowerCase() === message.data.sender?.toLowerCase(),
            )
          )
            addUnread(message.data);
          setRecords((previous) => [
            ...previous.slice(-(MAX_RECORDS - 1)),
            message.data,
          ]);
          break;
        case "diagnostic":
          // Transport details are not user-facing connection progress.
          break;
        case "reconnecting":
          if (!lostConnection.current)
            addMarker(
              "Connection interrupted. Reconnecting; messages may be missing.",
            );
          lostConnection.current = true;
          setRetrying(true);
          break;
      }
    };
    try {
      if (experience.history_enabled) {
        try {
          const owner = {
            server: profile?.server ?? request.server,
            character: profile?.character ?? request.character,
          };
          const history = await invoke<ChatRecord[]>("load_history", { owner });
          if (id === generation.current) setRecords(history);
        } catch {
          setError(
            "Saved history could not be loaded. Connecting to live chat.",
          );
        }
      }
      if (id !== generation.current || !activeRef.current) return;
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
  const connection = connectionDisplay(
    active,
    stopping,
    status,
    retrying,
    now,
    stage,
  );
  const canSend =
    native && active && !stopping && !retrying && connection.healthy;
  async function sendChat(message: OutgoingMessage) {
    if (!canSend || !status?.session_id) throw "not_connected";
    const id = ++submissionId.current;
    const session = status.session_id;
    setSubmissions((previous) => [
      ...previous.slice(-(MAX_RECORDS - 1)),
      {
        id,
        message,
        session,
        afterMessageId: lastMessage.current,
        state: "submitting",
        at: Date.now(),
      },
    ]);
    try {
      await invoke("send_chat", { request: { session_id: session, message } });
      setSubmissions((previous) =>
        previous.map((s) =>
          s.id === id && s.state === "submitting"
            ? { ...s, state: "submitted" }
            : s,
        ),
      );
    } catch (failure) {
      setSubmissions((previous) =>
        previous.map((s) => (s.id === id ? { ...s, state: "failed" } : s)),
      );
      throw failure;
    }
  }
  return (
    <main
      className={`app-shell${experience.compact ? " compact" : ""}${experience.high_contrast ? " high-contrast" : ""}`}
      style={{ "--chat-size": `${experience.text_size}px` } as CSSProperties}
    >
      <header className="app-header">
        <div className="header-title">
          <h1>P99 Mobile Chat</h1>
          {tab === "chat" && sessionIdentity?.character && (
            <p className="session-context">
              {sessionIdentity.character} ·{" "}
              {serverLabel(sessionIdentity.server)}
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
      {active && backgroundNotice && (
        <div className="notice" role="status">
          {backgroundNotice}
        </div>
      )}
      {!native && (
        <div className="notice preview">
          UI preview · Use the installed app to connect.
        </div>
      )}

      {tab === "settings" ? (
        <section className="settings-view">
          <SavedProfiles
            vault={vault}
            disabled={disabled}
            onConnect={(profile) => void connect(profile)}
            onEdit={editProfile}
            onDelete={setConfirmation}
          />
          <form onSubmit={submitConnection}>
            <h2 className="manual-heading">
              {editing ? "Edit saved character" : "New connection"}
            </h2>
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
                      ? "leave blank to keep saved login"
                      : "login server account"
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
                      ? "leave blank to keep saved password"
                      : active
                        ? "in use for this session"
                        : "login password"
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
                {SERVERS.map((server) => (
                  <button
                    className={settings.server === server ? "selected" : ""}
                    type="button"
                    key={server}
                    aria-pressed={settings.server === server}
                    onClick={() =>
                      setSettings((previous) => ({ ...previous, server }))
                    }
                  >
                    {serverLabel(server)}
                  </button>
                ))}
              </div>
              {settings.server === "quarm" && (
                <p className="settings-note">
                  Use your TAKP login-server account.
                </p>
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
                  placeholder="character name"
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
                    : "Login"}
              </button>
            )}
          </form>
          <p className="settings-note">
            Settings save automatically. Saving your login is optional. Your
            phone may pause connections in the background.
          </p>
        </section>
      ) : tab === "preferences" ? (
        <Preferences
          value={experience}
          onChange={setExperience}
          active={active}
          onHistory={viewHistory}
          onClear={clearView}
        />
      ) : (
        <section className="chat-view" aria-label="Chat">
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
                  <button
                    key={name}
                    type="button"
                    className={`channel-toggle channel-${name}`}
                    aria-pressed={channels.includes(name)}
                    onClick={() =>
                      setChannels((previous) =>
                        previous.includes(name)
                          ? previous.filter((channel) => channel !== name)
                          : CHANNELS.filter(
                              (channel) =>
                                channel === name || previous.includes(channel),
                            ),
                      )
                    }
                  >
                    {channelLabel(name)}
                  </button>
                ))}
              </div>
            </fieldset>
            <input
              type="search"
              aria-label="Search retained messages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search messages"
            />
          </details>
          <div className="chat-toolbar">
            <span>{messageCount.toLocaleString()} messages</span>
            {unread.tells > 0 && (
              <button
                className="text-button unread-tells"
                onClick={() => {
                  setChannels(["tell"]);
                  setQuery("");
                  setFollow(true);
                }}
              >
                {unread.tells} unread {unread.tells === 1 ? "tell" : "tells"}
              </button>
            )}
            <button
              className="text-button"
              type="button"
              onClick={clearView}
              disabled={!messageCount}
            >
              Clear
            </button>
          </div>
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
            {entries.length ? (
              entries.map((entry) =>
                entry.kind === "message" ? (
                  <Fragment
                    key={
                      entry.submission
                        ? `outgoing-${entry.submission.id}`
                        : recordKey(entry.record)
                    }
                  >
                    {unread.boundary === recordKey(entry.record) && (
                      <div className="timeline-marker unread-divider">
                        New messages
                      </div>
                    )}
                    <MessageRow
                      record={entry.record}
                      onItem={setSelectedItem}
                      onReply={chooseReply}
                      onActions={setSelectedMessage}
                      delivery={entry.submission?.state}
                    />
                  </Fragment>
                ) : entry.kind === "outgoing" ? (
                  <OutgoingMessageRow
                    key={`outgoing-${entry.submission.id}`}
                    submission={entry.submission}
                  />
                ) : (
                  <div
                    className="timeline-marker"
                    key={`timeline-${entry.marker.id}`}
                  >
                    <time>
                      {new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>{" "}
                    {entry.marker.text}
                  </div>
                ),
              )
            ) : (
              <div className="empty-state">
                <h3>
                  {!channels.length
                    ? "No channels selected"
                    : messageCount
                      ? "No matching messages"
                      : active
                        ? "Waiting for messages"
                        : "No messages yet"}
                </h3>
                <p>
                  {!channels.length
                    ? "Open Filters to choose which channels to show."
                    : messageCount
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
          {!follow && entries.length > 0 && (
            <button className="latest-button" onClick={() => setFollow(true)}>
              {unread.count
                ? `${unread.count} new ${unread.count === 1 ? "message" : "messages"}`
                : "Latest messages"}
            </button>
          )}
        </section>
      )}
      <ChatComposer
        server={sessionIdentity?.server ?? settings.server}
        key={generation.current}
        hidden={tab !== "chat"}
        connected={canSend}
        reply={reply}
        onSend={sendChat}
      />
      {(active || status) && (
        <div
          className={`chat-footer ${connection.busy ? "connection-progress" : ""}`}
        >
          <div
            className={`connection-feedback ${connection.healthy ? "online" : ""}`}
          >
            {connection.progress !== null && (
              <div
                className="signin-progress"
                role="progressbar"
                aria-label="Sign-in progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={connection.progress}
                aria-valuetext={`${connection.progress}% · ${connection.detail}`}
              >
                <span style={{ width: `${connection.progress}%` }} />
              </div>
            )}
            <span
              className="connection-detail"
              role="status"
              aria-label="Connection health"
            >
              {connection.detail}
            </span>
            {connection.progress !== null && (
              <span className="connection-percentage" aria-hidden="true">
                {connection.progress}%
              </span>
            )}
          </div>
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
          description={`Save ${pendingLogin.character} on ${serverLabel(pendingLogin.server)} with this account and password for next time? Your connection will continue either way.`}
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
              ? "Disconnect from the server?"
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
        <ItemModal
          item={selectedItem}
          server={sessionIdentity?.server ?? settings.server}
          onClose={() => setSelectedItem(null)}
        />
      )}
      {selectedMessage && (
        <MessageActions
          record={selectedMessage}
          muted={muted(selectedMessage)}
          onReply={chooseReply}
          onMute={(name) =>
            setExperience((previous) => ({
              ...previous,
              muted_authors: previous.muted_authors.some(
                (n) => n.toLowerCase() === name.toLowerCase(),
              )
                ? previous.muted_authors.filter(
                    (n) => n.toLowerCase() !== name.toLowerCase(),
                  )
                : [...previous.muted_authors.slice(-199), name],
            }))
          }
          onClose={() => setSelectedMessage(null)}
        />
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className={tab === "chat" ? "selected" : ""}
          aria-current={tab === "chat" ? "page" : undefined}
          onClick={() => setTab("chat")}
        >
          Chat{" "}
          {unread.count > 0 && (
            <span
              className="unread-badge"
              aria-label={`${unread.count} unread messages`}
            >
              {unread.count > 99 ? "99+" : unread.count}
            </span>
          )}
        </button>
        <button
          className={tab === "settings" ? "selected" : ""}
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => setTab("settings")}
        >
          Connection
        </button>
        <button
          className={tab === "preferences" ? "selected" : ""}
          aria-current={tab === "preferences" ? "page" : undefined}
          onClick={() => setTab("preferences")}
        >
          Settings
        </button>
      </nav>
    </main>
  );
}
