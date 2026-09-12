import type { Server } from "./protocol";

export interface Experience {
  text_size: number;
  compact: boolean;
  high_contrast: boolean;
  history_enabled: boolean;
  history_days: number;
  history_limit: number;
  notify_tells: boolean;
  notify_guild: boolean;
  notify_keywords: string[];
  notification_previews: boolean;
  muted_authors: string[];
}
export const defaultExperience: Experience = {
  text_size: 16,
  compact: true,
  high_contrast: false,
  history_enabled: true,
  history_days: 7,
  history_limit: 5000,
  notify_tells: false,
  notify_guild: false,
  notify_keywords: [],
  notification_previews: false,
  muted_authors: [],
};
export interface HistoryOwner {
  server: Server;
  character: string;
}
export interface HistoryProfile extends HistoryOwner {
  messages: number;
}
export interface ExportDocument {
  text: string;
  format: "txt" | "jsonl" | "json";
}
