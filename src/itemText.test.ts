import { describe, expect, it } from "vitest";
import { itemText } from "./itemText";
import type { ItemLink } from "./protocol";
const link = (start?: number, end?: number): ItemLink => ({
  body: "0".repeat(45),
  text: "Épée",
  item_id: 42,
  start: 100,
  end: 152,
  text_start: start,
  text_end: end,
});

describe("decoded item text ranges", () => {
  it("links the exact occurrence after Unicode and replacement characters", () => {
    const prefix = "Épée is plain text. 🗡 � Selling ";
    const start = new TextEncoder().encode(prefix).length;
    const { parts, remaining } = itemText({
      text: prefix + "Épée today",
      item_links: [link(start, start + 6)],
    });
    expect(parts.map((p) => p.text).join("")).toBe(prefix + "Épée today");
    expect(parts.filter((p) => p.link).map((p) => p.text)).toEqual(["Épée"]);
    expect(remaining).toHaveLength(0);
  });
  it("preserves text and separate buttons for old records or invalid ranges", () => {
    for (const entry of [
      link(),
      link(1, 6),
      link(-1, 5),
      link(0, 100),
      link(0, 1),
    ]) {
      const result = itemText({ text: "Épée today", item_links: [entry] });
      expect(result.parts).toEqual([{ text: "Épée today" }]);
      expect(result.remaining).toEqual([entry]);
    }
  });
});
