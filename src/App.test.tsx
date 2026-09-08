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
import App from "./App";
import type { AppEvent } from "./protocol";

const native = vi.hoisted(() => ({
  enabled: true,
  invoke: vi.fn(),
  channels: [] as Array<{ onmessage: (event: AppEvent) => void }>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.enabled,
  invoke: native.invoke,
  Channel: class {
    onmessage = (_event: AppEvent) => {};
    constructor() {
      native.channels.push(this);
    }
  },
}));
beforeEach(() => {
  native.enabled = true;
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.channels.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function connect() {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Login account"), {
    target: { value: "EXAMPLE_ACCOUNT" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "EXAMPLE_PASSWORD" },
  });
  fireEvent.change(screen.getByLabelText("Character name"), {
    target: { value: "ExampleCharacter" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Connect to character/ }));
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "connect",
      expect.objectContaining({
        request: {
          user: "EXAMPLE_ACCOUNT",
          pass: "EXAMPLE_PASSWORD",
          character: "ExampleCharacter",
          server: "green",
        },
      }),
    ),
  );
  await screen.findByRole("heading", { name: "Conversation" });
}

describe("connection and chat", () => {
  it("sends credentials only through native IPC and clears the password input", async () => {
    await connect();
    expect(screen.getByText("Connecting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    expect(localStorage.length).toBe(0);
  });

  it("renders incoming text safely and filters the received channels", async () => {
    await connect();
    const record = {
      type: "chat" as const,
      timestamp: "2026-01-01T12:00:00Z",
      server: "Test Server",
      character: "ExampleCharacter",
      zone: "ecommons",
      session_id: "synthetic",
      sender: "ExampleTrader",
    };
    act(() => {
      native.channels[0].onmessage({
        type: "client",
        data: {
          type: "record",
          data: {
            ...record,
            message_id: 1,
            channel_name: "auction",
            text: "Selling <script>not HTML</script>",
            item_links: [
              {
                body: "0".repeat(45),
                text: "Example item",
                item_id: 1,
                start: 0,
                end: 2,
              },
            ],
          },
        },
      });
      native.channels[0].onmessage({
        type: "client",
        data: {
          type: "record",
          data: {
            ...record,
            message_id: 2,
            channel_name: "guild",
            text: "Guild example",
          },
        },
      });
    });
    expect(screen.getByText("Selling <script>not HTML</script>")).toBeTruthy();
    expect(screen.getByText("◇ Example item")).toBeTruthy();
    expect(document.querySelector(".messages script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "guild" }));
    expect(screen.queryByText("Selling <script>not HTML</script>")).toBeNull();
    expect(screen.getByText("Guild example")).toBeTruthy();
  });

  it("keeps the same session across background and foreground transitions", async () => {
    await connect();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("blur"));
    act(() => {
      native.channels[0].onmessage({
        type: "client",
        data: {
          type: "record",
          data: {
            type: "chat",
            timestamp: "2026-01-01T12:00:00Z",
            server: "Test Server",
            character: "ExampleCharacter",
            zone: "ecommons",
            session_id: "synthetic",
            message_id: 1,
            channel_name: "guild",
            text: "Background message",
          },
        },
      });
    });
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("focus"));
    expect(screen.getByText("Background message")).toBeTruthy();
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.channels).toHaveLength(1);
  });

  it("requests native shutdown before allowing a new connection", async () => {
    await connect();
    let stopped!: () => void;
    native.invoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          stopped = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(native.invoke).toHaveBeenLastCalledWith("disconnect");
    expect(screen.getByText("Disconnecting")).toBeTruthy();
    await act(async () => {
      stopped();
    });
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
  });

  it("keeps the browser preview disconnected", () => {
    native.enabled = false;
    render(<App />);
    expect(
      (
        screen.getByRole("button", {
          name: /Connect to character/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
