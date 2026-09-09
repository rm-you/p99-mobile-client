import labels from "./zones.json";

/** Expand known zone identifiers and preserve unfamiliar server names verbatim. */
export function zoneName(shortName: string): string {
  const key = shortName.toLowerCase();
  return Object.prototype.hasOwnProperty.call(labels, key)
    ? labels[key as keyof typeof labels]
    : shortName;
}
