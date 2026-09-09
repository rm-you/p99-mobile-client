// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { CHANNELS } from "./protocol";
import type { AppEvent, ClientEvent, SessionStatus } from "./protocol";

const profile = {
  id: "12345678-1234-4234-8234-123456789abc",
  character: "SavedCharacter",
  server: "green",
};
const otherProfile = {
  id: "22345678-1234-4234-8234-123456789abc",
  character: "OtherCharacter",
  server: "blue",
};
let savedProfiles: (typeof profile)[] = [];
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
  savedProfiles = [];
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  native.invoke.mockReset().mockImplementation((command: string, args: any) => {
    if (command === "load_settings")
      return Promise.resolve({
        version: 2,
        server: "green",
        character: "",
        channels: [...CHANNELS],
        filters_open: false,
        follow: true,
      });
    if (command === "credential_status")
      return Promise.resolve({
        available: true,
        profiles: savedProfiles,
        legacySaved: false,
      });
    if (command === "save_profile") {
      const { character, server, id } = args.request;
      const result = {
        id: id && id !== "legacy" ? id : profile.id,
        character,
        server,
      };
      savedProfiles = [
        ...savedProfiles.filter((p) => p.id !== result.id),
        result,
      ];
      return Promise.resolve(result);
    }
    if (command === "connect_saved")
      return Promise.resolve(savedProfiles.find((p) => p.id === args.id));
    return Promise.resolve();
  });
  native.channels.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function connect(keepSavePrompt = false) {
  render(<App />);
  await screen.findByRole("button", { name: /Login/ });
  fireEvent.change(screen.getByLabelText("Login account"), {
    target: { value: "EXAMPLE_ACCOUNT" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "EXAMPLE_PASSWORD" },
  });
  fireEvent.change(screen.getByLabelText("Character name"), {
    target: { value: "ExampleCharacter" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Login/ }));
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
  await screen.findByRole("region", { name: "Chat" });
  if (!keepSavePrompt)
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
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
    const progress = () =>
      screen.getByRole("progressbar", { name: "Sign-in progress" });
    expect(progress().getAttribute("aria-valuenow")).toBe("0");
    expect(health().textContent).toBe("Signing in to P99…");
    send({ type: "diagnostic", data: "World opcode 0x1234: deadbeef" });
    expect(health().textContent).toBe("Signing in to P99…");
    for (const [stage, percentage, label] of [
      ["authenticating", 13, "Checking login details…"],
      ["selecting_server", 25, "Selecting server…"],
      ["connecting_world", 38, "Connecting to server…"],
      ["selecting_character", 50, "Selecting character…"],
      ["connecting_zone", 63, "Connecting to zone…"],
      ["loading_character", 75, "Loading character…"],
      ["entering_world", 88, "Entering the game world…"],
    ] as const) {
      send({ type: "progress", data: stage });
      expect(progress().getAttribute("aria-valuenow")).toBe(String(percentage));
      expect(health().textContent).toBe(label);
      expect(screen.getByText(`${percentage}%`)).toBeTruthy();
    }
    // Other events do not advance the step count while the server is still busy.
    send({ type: "diagnostic", data: "World opcode 0x1234: deadbeef" });
    expect(progress().getAttribute("aria-valuenow")).toBe("88");
    send({ type: "status", data: sessionStatus("zoning") });
    expect(health().textContent).toBe("Entering the game world…");
    send({ type: "progress", data: "ready" });
    expect(progress().getAttribute("aria-valuenow")).toBe("100");
    send({ type: "status", data: sessionStatus("connected") });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(health().textContent).toBe("Connection healthy");
    expect(health().closest(".connection-feedback.online")).not.toBeNull();
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
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector(".connection-status.online")).toBeNull();
    send({ type: "status", data: sessionStatus("connecting") });
    expect(progress().getAttribute("aria-valuenow")).toBe("0");
    expect(health().textContent).toBe("Signing in to P99…");
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect(health().textContent).toBe("Signing in to P99…");
    act(() =>
      native.channels[0].onmessage({
        type: "finished",
        data: { error: "connection_lost" },
      }),
    );
    expect(health().textContent).toBe("Disconnected");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Connection ended. Please try connecting again.",
    );
    expect(document.body.innerHTML).not.toMatch(/0x1234|deadbeef|12345|67890/);
  });

  it("shows rejected credentials and returns to the connection form without restarting", async () => {
    await connect(true);
    act(() =>
      native.channels[0].onmessage({
        type: "finished",
        data: { error: "invalid_credentials" },
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "The login account or password was rejected. Check your login details and try again.",
    );
    expect(
      screen.getByRole("heading", { name: "Manual connection", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      native.invoke.mock.calls.filter(([name]) => name === "connect"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Login" }).hasAttribute("disabled"),
    ).toBe(false);
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
    fireEvent.click(screen.getByText("Filters", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "guild" }));
    expect(screen.queryByText("Selling <script>not HTML</script>")).toBeNull();
    expect(screen.getByText("Guild example")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "auction" }));
    expect(screen.getByText("Selling <script>not HTML</script>")).toBeTruthy();
    expect(screen.getByText("Guild example")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Guild" },
    });
    expect(screen.queryByText("Selling <script>not HTML</script>")).toBeNull();
    expect(screen.getByText("Guild example")).toBeTruthy();
    fireEvent.click(
      screen.getByText("Filters · Active", { selector: "summary" }),
    );
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

  it("saves independent channel choices and collapsed filter visibility", async () => {
    await connect();
    fireEvent.click(screen.getByText("Filters", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByText("No channels selected")).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(
      CHANNELS.length,
    );
    fireEvent.click(screen.getByRole("button", { name: "guild" }));
    fireEvent.click(screen.getByRole("button", { name: "tell" }));
    expect(
      screen
        .getAllByRole("button", { pressed: true })
        .map((button) => button.textContent),
    ).toEqual(["guild", "tell"]);
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          version: 2,
          channels: ["guild", "tell"],
        }),
      }),
    );
    fireEvent.click(
      screen.getByText("Filters · Active", { selector: "summary" }),
    );
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({
          channels: ["guild", "tell"],
        }),
      }),
    );
    // jsdom's accessibility queries do not hide descendants of closed details.
    expect(
      (
        screen.getByText("Filters · Active", { selector: "summary" })
          .parentElement as HTMLDetailsElement
      ).open,
    ).toBe(false);
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
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      native.invoke.mock.calls.some(([name]) => name === "disconnect"),
    ).toBe(false);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      native.invoke.mock.calls.some(([name]) => name === "disconnect"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(native.invoke).toHaveBeenLastCalledWith("disconnect");
    expect(screen.getByText("Disconnecting")).toBeTruthy();
    await act(async () => {
      stopped();
    });
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
  });

  it("lists saved characters beside the manual form and connects by id only", async () => {
    savedProfiles = [profile, otherProfile];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "load_settings")
        return Promise.resolve({
          version: 2,
          server: "blue",
          character: "ManualCharacter",
          channels: ["guild", "tell"],
          filters_open: true,
          follow: false,
        });
      return fallback(command, ...args);
    });
    render(<App />);
    const saved = await screen.findByRole("button", {
      name: /Unlock and connect SavedCharacter/,
    });
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(
      (screen.getByLabelText("Character name") as HTMLInputElement).value,
    ).toBe("");
    expect(
      native.invoke.mock.calls.some(([name]) => name === "connect_saved"),
    ).toBe(false);
    fireEvent.click(saved);
    await screen.findByRole("region", { name: "Chat" });
    const args = native.invoke.mock.calls.find(
      ([name]) => name === "connect_saved",
    )![1];
    expect(Object.keys(args).sort()).toEqual(["id", "onEvent"]);
    expect(args.id).toBe(profile.id);
    expect(screen.getByText("SavedCharacter · P99 Green")).toBeTruthy();
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(
      false,
    );
    expect(
      screen
        .getByRole("button", { name: "guild" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect(
      (screen.getByLabelText("Character name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("offers to save after starting a manual connection, keeping secrets out of preferences", async () => {
    await connect(true);
    expect(screen.getByRole("dialog").textContent).toContain(
      "Save this character?",
    );
    expect(native.invoke.mock.calls.some(([name]) => name === "connect")).toBe(
      true,
    );
    expect(
      native.invoke.mock.calls.some(([name]) => name === "save_profile"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    await screen.findByRole("button", {
      name: /Unlock and connect ExampleCharacter/,
    });
    expect(native.invoke).toHaveBeenCalledWith("save_profile", {
      request: {
        id: null,
        character: "ExampleCharacter",
        server: "green",
        user: "EXAMPLE_ACCOUNT",
        pass: "EXAMPLE_PASSWORD",
      },
    });
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    expect(
      (screen.getByLabelText("Login account") as HTMLInputElement).value,
    ).toBe("");
    await waitFor(() =>
      expect(
        native.invoke.mock.calls.some(([name]) => name === "save_settings"),
      ).toBe(true),
    );
    for (const [name, args] of native.invoke.mock.calls)
      if (name === "save_settings") {
        expect(JSON.stringify(args)).not.toMatch(
          /EXAMPLE_ACCOUNT|EXAMPLE_PASSWORD|ExampleCharacter|filters_open/,
        );
      }
    expect(localStorage.length).toBe(0);
    expect(
      native.invoke.mock.calls.some(([name]) => name === "disconnect"),
    ).toBe(false);
  });

  it("does not save or disconnect when the save offer is declined", async () => {
    await connect();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      native.invoke.mock.calls.some(
        ([name]) => name === "save_profile" || name === "disconnect",
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Connection" }));
    expect(
      screen.queryByRole("button", { name: "Save character securely" }),
    ).toBeNull();
  });

  it("offers to update the matching saved entry and keeps the session when saving is cancelled", async () => {
    savedProfiles = [{ ...profile, character: "ExampleCharacter" }];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string, ...args: unknown[]) =>
      command === "save_profile"
        ? Promise.reject("Character was not saved.")
        : fallback(command, ...args),
    );
    await connect(true);
    expect(screen.getByRole("dialog").textContent).toContain(
      "Update saved login?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(native.invoke).toHaveBeenCalledWith("save_profile", {
      request: expect.objectContaining({ id: profile.id }),
    });
    expect(screen.getByText("Connecting", { exact: true })).toBeTruthy();
    expect(
      native.invoke.mock.calls.some(([name]) => name === "disconnect"),
    ).toBe(false);
  });

  it("edits labels while keeping credentials native and deletes only the selected profile", async () => {
    savedProfiles = [profile, otherProfile];
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Edit SavedCharacter/ }),
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.change(screen.getByLabelText("Character name"), {
      target: { value: "RenamedCharacter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("button", {
      name: /Unlock and connect RenamedCharacter/,
    });
    expect(native.invoke).toHaveBeenCalledWith("save_profile", {
      request: {
        id: profile.id,
        character: "RenamedCharacter",
        server: "green",
        user: "",
        pass: "",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Delete RenamedCharacter/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: /Unlock and connect RenamedCharacter/,
        }),
      ).toBeNull(),
    );
    expect(native.invoke).toHaveBeenCalledWith("forget_profile", {
      id: profile.id,
    });
    expect(
      screen.getByRole("button", { name: /Unlock and connect OtherCharacter/ }),
    ).toBeTruthy();
  });

  it("clears an edited profile name when returning to the manual form", async () => {
    savedProfiles = [profile];
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Edit SavedCharacter/ }),
    );
    expect(
      (screen.getByLabelText("Character name") as HTMLInputElement).value,
    ).toBe("SavedCharacter");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(
      (screen.getByLabelText("Character name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("retains the old single login until the user assigns a character and saves", async () => {
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string, ...args: unknown[]) =>
      command === "credential_status"
        ? Promise.resolve({ available: true, profiles: [], legacySaved: true })
        : fallback(command, ...args),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Previous saved login/ }),
    );
    fireEvent.change(screen.getByLabelText("Character name"), {
      target: { value: "ImportedCharacter" },
    });
    expect(
      native.invoke.mock.calls.some(([name]) => name === "save_profile"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("save_profile", {
        request: {
          id: "legacy",
          character: "ImportedCharacter",
          server: "green",
          user: "",
          pass: "",
        },
      }),
    );
  });

  it("leaves cancelled authentication offline with the saved entry intact", async () => {
    savedProfiles = [profile];
    const fallback = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string, ...args: unknown[]) =>
      command === "connect_saved"
        ? Promise.reject("Character was not unlocked.")
        : fallback(command, ...args),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Unlock and connect SavedCharacter/,
      }),
    );
    await screen.findByRole("alert");
    expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Unlock and connect SavedCharacter/ }),
    ).toBeTruthy();
    expect(native.invoke.mock.calls.some(([name]) => name === "connect")).toBe(
      false,
    );
  });

  it("discards only empty guild MOTDs and keeps populated announcements", async () => {
    await connect();
    const record = {
      type: "chat" as const,
      timestamp: "2026-01-01T12:00:00Z",
      server: "Test Server",
      character: "ExampleCharacter",
      zone: "ecommons",
      session_id: "synthetic",
      channel_name: "guild_motd",
      message_id: 1,
    };
    send({ type: "record", data: { ...record, text: "  \n " } });
    send({
      type: "record",
      data: {
        ...record,
        message_id: 2,
        arguments: [{ text: "" }],
        string_id: 123,
      },
    });
    expect(screen.getByText("0 messages")).toBeTruthy();
    send({
      type: "record",
      data: { ...record, message_id: 3, text: "Guild announcement" },
    });
    send({
      type: "record",
      data: {
        ...record,
        message_id: 4,
        channel_name: "motd",
        text: "Server announcement",
      },
    });
    expect(screen.getByText("2 messages")).toBeTruthy();
    expect(screen.getByText("Guild announcement")).toBeTruthy();
    expect(screen.getByText("Server announcement")).toBeTruthy();
  });

  it("keeps the browser preview disconnected", () => {
    native.enabled = false;
    render(<App />);
    expect(
      (
        screen.getByRole("button", {
          name: /Login/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(native.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText("No messages yet")).toBeTruthy();
    expect(screen.getByText("0 messages")).toBeTruthy();
  });
});
