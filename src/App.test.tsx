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
import type { AppEvent, ClientEvent, SessionStatus } from "./protocol";

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
  native.invoke.mockReset().mockImplementation((command: string) => {
    if (command === "load_settings")
      return Promise.resolve({
        version: 1,
        server: "green",
        character: "",
        channel: "all",
        follow: true,
      });
    if (command === "credential_status")
      return Promise.resolve({ available: true, saved: false });
    return Promise.resolve();
  });
  native.channels.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function connect() {
  render(<App />);
  await screen.findByRole("button", { name: /Connect to character/ });
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
  await screen.findByRole("heading", { name: "Chat" });
}

function send(event: ClientEvent) {
  act(() => native.channels[0].onmessage({ type: "client", data: event }));
}

function sessionStatus(state: SessionStatus["state"]): SessionStatus {
  return {
    state,
    zone: "ecommons",
    messages: 67890,
    packets: 12345,
    last_received_seconds: 0,
    session_id: "synthetic-status",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

describe("connection and chat", () => {
  it("shows connection stages and health without packet diagnostics or counts", async () => {
    await connect();
    const health = () =>
      screen.getByRole("status", { name: "Connection health" });
    expect(health().textContent).toBe("Signing in to P99…");
    send({ type: "diagnostic", data: "World opcode 0x1234: deadbeef" });
    expect(health().textContent).toBe("Signing in to P99…");
    send({ type: "status", data: sessionStatus("zoning") });
    expect(health().textContent).toBe("Entering the game world…");
    send({ type: "status", data: sessionStatus("connected") });
    expect(health().textContent).toBe("Connection healthy");
    send({
      type: "diagnostic",
      data: "Zone session: 12345 application packets, 67890 communication records",
    });
    expect(health().textContent).toBe("Connection healthy");
    expect(document.querySelector(".connection-status.online")).not.toBeNull();
    send({
      type: "reconnecting",
      data: { error: "Unexpected opcode 0x1234: deadbeef", delay_seconds: 15 },
    });
    expect(health().textContent).toBe("Connection interrupted · Retrying…");
    expect(document.querySelector(".connection-status.online")).toBeNull();
    send({ type: "status", data: sessionStatus("connecting") });
    expect(health().textContent).toBe("Signing in to P99…");
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect(health().textContent).toBe("Signing in to P99…");
    act(() =>
      native.channels[0].onmessage({
        type: "finished",
        data: { error: "Unexpected opcode 0x1234: deadbeef" },
      }),
    );
    expect(health().textContent).toBe("Disconnected");
    expect(screen.getByRole("alert").textContent).toBe(
      "Connection ended. Please try connecting again.",
    );
    expect(document.body.innerHTML).not.toMatch(/0x1234|deadbeef|12345|67890/);
  });

  it("stops claiming a healthy connection when status updates stall", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    await connect();
    send({ type: "status", data: sessionStatus("connected") });
    clock.mockReturnValue(1800000061000);
    fireEvent(document, new Event("visibilitychange"));
    expect(
      screen.getByRole("status", { name: "Connection health" }).textContent,
    ).toBe("Waiting for server…");
    expect(document.querySelector(".connection-status.online")).toBeNull();
    // The core also uses zoning for a previously admitted but silent session.
    send({
      type: "status",
      data: { ...sessionStatus("zoning"), last_received_seconds: 61 },
    });
    expect(
      screen.getByRole("status", { name: "Connection health" }).textContent,
    ).toBe("Waiting for server…");
    send({ type: "status", data: sessionStatus("connected") });
    expect(
      screen.getByRole("status", { name: "Connection health" }).textContent,
    ).toBe("Connection healthy");
  });

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
    expect(screen.getByText("Example item")).toBeTruthy();
    expect(document.querySelector(".messages script")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Chat channel" }), {
      target: { value: "guild" },
    });
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
    expect(
      native.invoke.mock.calls.filter(([name]) => name === "connect"),
    ).toHaveLength(1);
    expect(
      native.invoke.mock.calls.some(([name]) => name === "disconnect"),
    ).toBe(false);
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

  it("restores preferences without unlocking or reading the saved secret into the webview", async () => {
    native.invoke.mockImplementation((command: string) => {
      if (command === "load_settings")
        return Promise.resolve({
          version: 1,
          server: "blue",
          character: "ExampleCharacter",
          channel: "guild",
          follow: false,
        });
      if (command === "credential_status")
        return Promise.resolve({ available: true, saved: true });
      return Promise.resolve();
    });
    render(<App />);
    await screen.findByText("Saved login is locked");
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(
      native.invoke.mock.calls.some(([name]) => name === "connect_saved"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Unlock and connect/ }));
    await screen.findByRole("heading", { name: "Chat" });
    expect(native.invoke).toHaveBeenCalledWith(
      "connect_saved",
      expect.objectContaining({
        server: "blue",
        character: "ExampleCharacter",
      }),
    );
    expect(
      native.invoke.mock.calls.filter(
        ([name]) => name === "connect_saved",
      )[0][1],
    ).not.toHaveProperty("request");
    expect(
      (
        screen.getByRole("combobox", {
          name: "Chat channel",
        }) as HTMLSelectElement
      ).value,
    ).toBe("guild");
  });

  it("saves credentials separately, clears both inputs, and allows forgetting", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /Connect to character/ });
    fireEvent.change(screen.getByLabelText("Login account"), {
      target: { value: "EXAMPLE_ACCOUNT" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "EXAMPLE_PASSWORD" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save login securely" }),
    );
    await screen.findByText("Saved login is locked");
    expect(native.invoke).toHaveBeenCalledWith("save_credentials", {
      credentials: { user: "EXAMPLE_ACCOUNT", pass: "EXAMPLE_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Forget saved login" }));
    await screen.findByLabelText("Password");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (screen.getByLabelText("Login account") as HTMLInputElement).value,
    ).toBe("");
    expect(native.invoke).toHaveBeenCalledWith("forget_credentials");
    await waitFor(() =>
      expect(
        native.invoke.mock.calls.some(([name]) => name === "save_settings"),
      ).toBe(true),
    );
    for (const [name, args] of native.invoke.mock.calls) {
      if (name === "save_settings") {
        expect(JSON.stringify(args)).not.toContain("EXAMPLE_ACCOUNT");
        expect(JSON.stringify(args)).not.toContain("EXAMPLE_PASSWORD");
      }
    }
    expect(localStorage.length).toBe(0);
  });

  it("leaves a cancelled unlock offline and preserves the saved login for retry", async () => {
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "credential_status")
        return Promise.resolve({ available: true, saved: true });
      if (command === "connect_saved")
        return Promise.reject("Login was not unlocked.");
      return fallback(command, ...args);
    });
    render(<App />);
    await screen.findByText("Saved login is locked");
    fireEvent.change(screen.getByLabelText("Character name"), {
      target: { value: "ExampleCharacter" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Unlock and connect/ }));
    await screen.findByRole("alert");
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
    expect(screen.getByText("Saved login is locked")).toBeTruthy();
    expect(native.invoke.mock.calls.some(([name]) => name === "connect")).toBe(
      false,
    );
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
