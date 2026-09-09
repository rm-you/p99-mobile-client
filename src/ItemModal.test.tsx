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

describe("offline item modal", () => {
  it("looks up the selected item ID and name and renders text with an optional browser action", async () => {
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
      itemId: 42,
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
  it("offers the Wiki without retrying or fetching when an item is missing", async () => {
    native.invoke.mockRejectedValueOnce(
      "This item is not in the offline catalog.",
    );
    render(<ItemModal item={link} onClose={() => {}} />);
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: /View on P99 Wiki/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });
  it("reloads a different ID with the same name and ignores the old response", async () => {
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
        lines: ["Slot: BACK"],
      });
    const view = render(<ItemModal item={link} onClose={() => {}} />);
    view.rerender(
      <ItemModal item={{ ...link, item_id: 43 }} onClose={() => {}} />,
    );
    await screen.findByText("BACK");
    expect(native.invoke).toHaveBeenLastCalledWith("item_details", {
      itemId: 43,
      name: "Example Blade",
    });
    await act(async () => old(details));
    expect(screen.queryByText("PRIMARY")).toBeNull();
    expect(screen.getByText("BACK")).toBeTruthy();
  });
});
