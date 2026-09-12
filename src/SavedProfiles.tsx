import SwipeToDelete from "./SwipeToDelete";
import { serverLabel } from "./protocol";
import type { Server } from "./protocol";

export interface SavedProfile {
  id: string;
  character: string;
  server: Server;
}
export interface VaultStatus {
  available: boolean;
  profiles: SavedProfile[];
  legacySaved: boolean;
}
export const profileLabel = (profile: SavedProfile) =>
  `${profile.character} · ${serverLabel(profile.server)}`;

/** Keep labels visible while the credentials remain in native secure storage. */
export default function SavedProfiles({
  vault,
  disabled,
  onConnect,
  onEdit,
  onDelete,
}: {
  vault: VaultStatus;
  disabled: boolean;
  onConnect: (profile: SavedProfile) => void;
  onEdit: (profile: SavedProfile | "legacy") => void;
  onDelete: (profile: SavedProfile | "legacy") => void;
}) {
  if (!vault.profiles.length && !vault.legacySaved) return null;
  return (
    <section className="saved-profiles" aria-label="Saved characters">
      <h2>Saved characters</h2>
      <ul>
        {[...vault.profiles]
          .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
          .map((profile) => (
            <SwipeToDelete
              key={profile.id}
              disabled={disabled}
              onDelete={() => onDelete(profile)}
            >
              <button
                className="profile-connect"
                type="button"
                disabled={disabled || !vault.available}
                onClick={() => onConnect(profile)}
                aria-label={`Unlock and connect ${profileLabel(profile)}`}
              >
                <strong>{profile.character}</strong>
                <span>{serverLabel(profile.server)}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={`Edit ${profileLabel(profile)}`}
                onClick={() => onEdit(profile)}
              >
                <ProfileIcon edit />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={`Delete ${profileLabel(profile)}`}
                onClick={() => onDelete(profile)}
              >
                <ProfileIcon />
              </button>
            </SwipeToDelete>
          ))}
      </ul>
      {vault.legacySaved && (
        <div className="legacy-profile">
          <button
            className="profile-connect"
            type="button"
            disabled={disabled}
            onClick={() => onEdit("legacy")}
          >
            <strong>Previous saved login</strong>
            <span>Add a character and server</span>
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={disabled}
            aria-label="Delete previous saved login"
            onClick={() => onDelete("legacy")}
          >
            <ProfileIcon />
          </button>
        </div>
      )}
    </section>
  );
}
function ProfileIcon({ edit = false }: { edit?: boolean }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {edit ? (
        <>
          <path d="m16 3 5 5-12 12-6 1 1-6Z" />
          <path d="m14 5 5 5" />
        </>
      ) : (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
        </>
      )}
    </svg>
  );
}
