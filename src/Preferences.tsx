import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Experience,
  HistoryOwner,
  HistoryProfile,
  ExportDocument,
} from "./experience";
import ConfirmDialog from "./ConfirmDialog";
interface Info {
  version: string;
  build_id: string;
  network_revision: string;
  platform: string;
  notifications_supported: boolean;
}
export default function Preferences({
  value,
  onChange,
  active,
  onHistory,
  onClear,
}: {
  value: Experience;
  onChange: (next: Experience) => void;
  active: boolean;
  onHistory: (owner: HistoryOwner) => Promise<void>;
  onClear: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [profiles, setProfiles] = useState<HistoryProfile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [keywords, setKeywords] = useState(value.notify_keywords.join(", "));
  const change = <K extends keyof Experience>(key: K, next: Experience[K]) =>
    onChange({ ...value, [key]: next });
  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    void Promise.allSettled([
      invoke<Info>("app_info"),
      invoke<HistoryProfile[]>("history_profiles"),
    ]).then(([i, p]) => {
      if (cancelled) return;
      if (i.status === "fulfilled") setInfo(i.value);
      if (p.status === "fulfilled") setProfiles(p.value);
      if (i.status === "rejected" || p.status === "rejected")
        setError("Could not load app information or saved history.");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function perform(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(typeof e === "string" ? e : "Could not complete that action.");
    } finally {
      setBusy(false);
    }
  }
  const share = async (document: ExportDocument) => {
    await invoke(
      "share_document",
      document as unknown as Record<string, unknown>,
    );
  };
  return (
    <section className="preferences-view" aria-label="Settings">
      <section>
        <h2>Appearance</h2>
        <label>
          Chat text size
          <select
            value={value.text_size}
            onChange={(e) => change("text_size", Number(e.target.value))}
          >
            {[12, 14, 16, 18, 20, 22].map((size) => (
              <option key={size} value={size}>
                {size}
                {size === 16 ? " · Default" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="preference-toggle">
          <input
            type="checkbox"
            checked={value.compact}
            onChange={(e) => change("compact", e.target.checked)}
          />
          Compact chat spacing
        </label>
        <label className="preference-toggle">
          <input
            type="checkbox"
            checked={value.high_contrast}
            onChange={(e) => change("high_contrast", e.target.checked)}
          />
          Higher-contrast channel colors
        </label>
        <p className="settings-note">
          Classic EQ colors are the default. Your text size applies to chat and
          item details.
        </p>
      </section>
      <section>
        <h2>Chat history</h2>
        <label className="preference-toggle">
          <input
            type="checkbox"
            checked={value.history_enabled}
            onChange={(e) => change("history_enabled", e.target.checked)}
          />
          Save chat on this device
        </label>
        <p className="settings-note">
          History includes character names and messages. Turning saving off
          stops new writes; existing history remains until it expires or you
          clear it. Login passwords are never included.
        </p>
        <div className="preference-columns">
          <label>
            Keep for
            <select
              value={value.history_days}
              onChange={(e) => change("history_days", Number(e.target.value))}
            >
              {[1, 7, 30].map((days) => (
                <option key={days} value={days}>
                  {days} {days === 1 ? "day" : "days"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Per character
            <select
              value={value.history_limit}
              onChange={(e) => change("history_limit", Number(e.target.value))}
            >
              {[1000, 5000, 10000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} messages
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="settings-note">
          Up to 20,000 messages total across characters. The chat view loads the
          latest 1,500; exports include all retained messages for that
          character.
        </p>
        {profiles.map((p) => (
          <div className="history-profile" key={`${p.server}-${p.character}`}>
            <div>
              <strong>{p.character}</strong>
              <span>
                P99 {p.server === "green" ? "Green" : "Blue"} ·{" "}
                {p.messages.toLocaleString()} messages
              </span>
            </div>
            <div className="history-actions">
              <button
                disabled={active || busy}
                onClick={() => void perform(() => onHistory(p))}
              >
                View
              </button>
              {(["text", "jsonl"] as const).map((format) => (
                <button
                  key={format}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () =>
                      share(
                        await invoke<ExportDocument>("export_history", {
                          owner: { server: p.server, character: p.character },
                          format,
                        }),
                      ),
                    )
                  }
                >
                  {format === "text" ? "Export text" : "Export JSONL"}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!profiles.length && (
          <p className="settings-note">No saved history yet.</p>
        )}
        <button
          className="secondary-button destructive"
          disabled={busy || !profiles.length}
          onClick={() => setConfirm(true)}
        >
          Clear saved history
        </button>
      </section>
      {info?.notifications_supported && (
        <section>
          <h2>Notifications</h2>
          <p className="settings-note">
            Get alerts while the app is in the background and connected.
          </p>
          <fieldset disabled={!info?.notifications_supported}>
            <label className="preference-toggle">
              <input
                type="checkbox"
                checked={value.notify_tells}
                onChange={(e) => change("notify_tells", e.target.checked)}
              />
              Incoming tells
            </label>
            <label className="preference-toggle">
              <input
                type="checkbox"
                checked={value.notify_guild}
                onChange={(e) => change("notify_guild", e.target.checked)}
              />
              Guild messages
            </label>
            <label>
              Keywords
              <input
                placeholder="separate with commas"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                onBlur={() => {
                  const words = [
                    ...new Set(
                      keywords
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ].slice(0, 20);
                  if (
                    words.some((s) => s.length > 80 || /[\x00-\x1f]/.test(s))
                  ) {
                    setError(
                      "Keep keywords under 80 characters without control characters.",
                    );
                    return;
                  }
                  change("notify_keywords", words);
                }}
              />
            </label>
            <label className="preference-toggle">
              <input
                type="checkbox"
                checked={value.notification_previews}
                onChange={(e) =>
                  change("notification_previews", e.target.checked)
                }
              />
              Include sender and message preview
            </label>
          </fieldset>
          <p className="settings-note">
            Alerts are off by default. Muted authors never trigger alerts; the
            lock screen uses a generic notice. Change sound and notification
            permissions in Android settings.
          </p>
          <button
            className="secondary-button"
            disabled={busy || active || !info?.notifications_supported}
            onClick={() =>
              void perform(async () => {
                await invoke("test_notification");
              })
            }
          >
            Test notification
          </button>
          <p className="settings-note">
            Test while disconnected; no game session is started.
          </p>
        </section>
      )}
      <section>
        <h2>Muted authors</h2>
        {value.muted_authors.length ? (
          value.muted_authors.map((name) => (
            <div className="muted-row" key={name}>
              <span>{name}</span>
              <button
                className="text-button"
                onClick={() =>
                  change(
                    "muted_authors",
                    value.muted_authors.filter((s) => s !== name),
                  )
                }
              >
                Unmute {name}
              </button>
            </div>
          ))
        ) : (
          <p className="settings-note">
            Long-press a message to mute its author. Muting hides their messages
            and alerts; it does not delete saved history.
          </p>
        )}
      </section>
      <section>
        <h2>About</h2>
        <p className="about-name">P99 Mobile Chat {info?.version ?? ""}</p>
        {info && (
          <p className="settings-note">
            Build {info.build_id} · {info.platform}
            <br />
            Networking {info.network_revision.slice(0, 8)}
          </p>
        )}
        <div className="about-links">
          {(
            [
              ["source", "Source code"],
              ["issues", "Report an issue"],
              ["credits", "Data & credits"],
              ["licenses", "Component licenses"],
              ["privacy", "Privacy"],
            ] as const
          ).map(([link, label]) => (
            <button
              key={link}
              className="text-button"
              onClick={() =>
                void perform(async () => {
                  await invoke("open_info_link", { link });
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void perform(async () =>
              share(await invoke<ExportDocument>("export_diagnostics")),
            )
          }
        >
          Export diagnostics
        </button>
        <p className="settings-note">
          Diagnostics contain version, platform, counters, and storage status.
          They exclude account details, character names, messages, raw packets,
          and file paths.
        </p>
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title="Clear saved history?"
          description="Remove stored chat for every character on this device. New messages will still be saved if saving is enabled."
          confirm="Clear history"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void perform(async () => {
              await invoke("clear_history");
              setProfiles([]);
              onClear();
            });
          }}
        />
      )}
    </section>
  );
}
