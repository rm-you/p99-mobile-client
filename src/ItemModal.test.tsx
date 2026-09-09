// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ItemModal from "./ItemModal";
import type { ItemDetails } from "./ItemModal";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const link = {
  body: "0".repeat(45),
  text: "Example Blade",
  item_id: 42,
  start: 0,
  end: 60,
};
const details: ItemDetails = {
  name: "Example Blade",
  lines: [
    "MAGIC ITEM LORE ITEM",
    "Slot: PRIMARY",
    "DMG: 12",
    "Effect: <script>text only</script>",
  ],
  source_url: "https://wiki.project1999.com/Example_Blade",
  fetched_at: 1000,
};
beforeEach(() => {
  native.invoke.mockReset();
  // jsdom has no native dialog implementation; real focus/modal behavior is
  // checked separately in the Android WebView.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("Wiki item modal", () => {
  it("loads only the selected name and renders text with a native browser action", async () => {
    let resolve!: (details: ItemDetails) => void;
    native.invoke.mockImplementation((name) =>
      name === "item_details"
        ? new Promise<ItemDetails>((done) => {
            resolve = done;
          })
        : Promise.resolve(),
    );
    const close = vi.fn();
    render(<ItemModal item={link} onClose={close} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading item details",
    );
    expect(native.invoke).toHaveBeenCalledWith("item_details", {
      name: "Example Blade",
    });
    await act(async () => resolve(details));
    expect(screen.getByText("PRIMARY")).toBeTruthy();
    expect(screen.getByText("<script>text only</script>")).toBeTruthy();
    expect(document.querySelector("dialog script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View on P99 Wiki/ }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("open_item_wiki", {
        name: "Example Blade",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close item details" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("offers retry and the source link when a lookup fails", async () => {
    native.invoke
      .mockRejectedValueOnce("No Wiki page was found for this item.")
      .mockResolvedValueOnce(details);
    render(<ItemModal item={link} onClose={() => {}} />);
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: /View on P99 Wiki/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("PRIMARY");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });
  it("ignores an old response after the selected item changes", async () => {
    let old!: (details: ItemDetails) => void;
    native.invoke
      .mockImplementationOnce(
        () =>
          new Promise<ItemDetails>((resolve) => {
            old = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...details,
        name: "Another Item",
        lines: ["Slot: BACK"],
      });
    const view = render(<ItemModal item={link} onClose={() => {}} />);
    view.rerender(
      <ItemModal item={{ ...link, text: "Another Item" }} onClose={() => {}} />,
    );
    await screen.findByText("BACK");
    await act(async () => old(details));
    expect(screen.queryByText("PRIMARY")).toBeNull();
    expect(screen.getByText("BACK")).toBeTruthy();
  });
});
