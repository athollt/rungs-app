import { render, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SessionForm, type FormSlot } from "./session-form";

const PLAYERS = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
];

function noop() {
  return Promise.resolve({ ok: true as const });
}

// The single "Choose players" grid; chips are toggle buttons named by player.
function chip(name: string) {
  return within(screen.getByRole("group", { name: /choose players/i })).getByRole(
    "button",
    { name },
  );
}

// Add an on-the-fly player via the "+ New" chip: open it, type the name, confirm.
// The confirm (✓) button uses onPointerDown (so it fires before the input's
// blur-to-cancel), so the test must fire pointerDown, not click.
function addNewChip(name: string) {
  fireEvent.click(chip("+ New"));
  fireEvent.change(screen.getByRole("textbox", { name: /new player name/i }), {
    target: { value: name },
  });
  fireEvent.pointerDown(screen.getByRole("button", { name: /add player/i }));
}

describe("SessionForm single-grid select-then-score", () => {
  it("shows no score block until a player is selected", () => {
    render(
      <SessionForm players={PLAYERS} submitLabel="Log Results" onSubmit={noop} />,
    );
    expect(screen.queryByRole("button", { name: "0 wins" })).toBeNull();
    // The submit button is always available (validation is server-side).
    expect(
      screen.getByRole("button", { name: "Log Results" }),
    ).toBeInTheDocument();
  });

  it("reveals a score block for a player when selected, and removes it when unselected", () => {
    render(
      <SessionForm players={PLAYERS} submitLabel="Log Results" onSubmit={noop} />,
    );

    fireEvent.click(chip("Alice"));
    const block = screen.getByRole("group", { name: "Alice" });
    expect(within(block).getAllByRole("button", { name: "0 wins" }).length).toBe(1);

    // Tapping the chip again unselects and drops the block.
    fireEvent.click(chip("Alice"));
    expect(screen.queryByRole("group", { name: "Alice" })).toBeNull();
  });

  it("emits one FormSlot per selected player with its wins", () => {
    let captured: FormSlot[] | null = null;
    const onSubmit = (slots: FormSlot[]) => {
      captured = slots;
      return Promise.resolve({ ok: true as const });
    };
    render(
      <SessionForm players={PLAYERS} submitLabel="Log" onSubmit={onSubmit} />,
    );

    fireEvent.click(chip("Alice"));
    fireEvent.click(chip("Bob"));
    const alice = screen.getByRole("group", { name: "Alice" });
    fireEvent.click(within(alice).getByRole("button", { name: "3 wins" }));
    const bob = screen.getByRole("group", { name: "Bob" });
    fireEvent.click(within(bob).getByRole("button", { name: "1 wins" }));

    fireEvent.click(screen.getByRole("button", { name: "Log" }));

    expect(captured).toEqual([
      { playerId: "p1", newName: undefined, wins: 3 },
      { playerId: "p2", newName: undefined, wins: 1 },
    ]);
  });

  it("adds a brand-new player by typing in the + New chip", () => {
    let captured: FormSlot[] | null = null;
    const onSubmit = (slots: FormSlot[]) => {
      captured = slots;
      return Promise.resolve({ ok: true as const });
    };
    render(
      <SessionForm players={PLAYERS} submitLabel="Log" onSubmit={onSubmit} />,
    );

    // Activating "+ New" turns the chip into a name field; confirming adds the
    // player as a selected chip in the grid AND a named score block below.
    addNewChip("Carol");

    // Appears as a selected chip in the "Choose players" grid.
    expect(chip("Carol")).toHaveAttribute("aria-pressed", "true");

    // A named score block now exists; set wins on it.
    const newBlock = screen.getByRole("group", { name: "Carol" });
    fireEvent.click(within(newBlock).getByRole("button", { name: "2 wins" }));

    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(captured).toEqual([
      { playerId: undefined, newName: "Carol", wins: 2 },
    ]);
  });

  it("removes an on-the-fly player when its grid chip is tapped", () => {
    render(
      <SessionForm players={PLAYERS} submitLabel="Log" onSubmit={noop} />,
    );

    addNewChip("Carol");
    expect(screen.getByRole("group", { name: "Carol" })).toBeInTheDocument();

    // Tapping the new player's grid chip removes it (chip + score block gone).
    fireEvent.click(chip("Carol"));
    expect(
      within(screen.getByRole("group", { name: /choose players/i })).queryByRole(
        "button",
        { name: "Carol" },
      ),
    ).toBeNull();
    expect(screen.queryByRole("group", { name: "Carol" })).toBeNull();
  });

  it("rejects a + New name that is already on the roster, with an inline error", () => {
    render(
      <SessionForm players={PLAYERS} submitLabel="Log" onSubmit={noop} />,
    );

    addNewChip("alice"); // matches "Alice" case-insensitively

    expect(screen.getByText(/already on the list/i)).toBeInTheDocument();
    // No new score block was created.
    expect(screen.queryByRole("group", { name: "alice" })).toBeNull();
  });

  it("supports adding more than one new player", () => {
    let captured: FormSlot[] | null = null;
    const onSubmit = (slots: FormSlot[]) => {
      captured = slots;
      return Promise.resolve({ ok: true as const });
    };
    render(
      <SessionForm players={PLAYERS} submitLabel="Log" onSubmit={onSubmit} />,
    );

    for (const name of ["Carol", "Dave"]) {
      addNewChip(name);
    }

    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(captured).toEqual([
      { playerId: undefined, newName: "Carol", wins: 0 },
      { playerId: undefined, newName: "Dave", wins: 0 },
    ]);
  });

  it("pre-selects players with their wins in edit mode (initialSlots)", () => {
    const initialSlots = [{ playerId: "p1", newName: "", wins: "3" }];
    render(
      <SessionForm
        players={PLAYERS}
        initialSlots={initialSlots}
        submitLabel="Save"
        onSubmit={noop}
      />,
    );
    const block = screen.getByRole("group", { name: "Alice" });
    expect(
      within(block).getByRole("button", { name: "3 wins" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(chip("Alice")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SessionForm WhatsApp share (step 16.4)", () => {
  const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    push.mockReset();
  });

  afterEach(() => {
    push.mockReset();
    if (originalShare) Object.defineProperty(navigator, "share", originalShare);
    else delete (navigator as unknown as { share?: unknown }).share;
    window.matchMedia = originalMatchMedia;
  });

  // Configure the environment: whether navigator.share exists, and whether the
  // device is touch-primary (coarse pointer). The Share button needs both.
  function setEnv({ share, coarse }: { share: boolean; coarse: boolean }) {
    if (share) {
      Object.defineProperty(navigator, "share", {
        value: vi.fn(() => Promise.resolve()),
        configurable: true,
      });
    } else {
      delete (navigator as unknown as { share?: unknown }).share;
    }
    window.matchMedia = ((query: string) => ({
      matches: query.includes("coarse") ? coarse : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  async function submitOneSession() {
    fireEvent.click(chip("Alice"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Alice" })).getByRole("button", {
        name: "3 wins",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Log Results" }));
    return screen.findByText(/session logged/i);
  }

  it("shows the Share button and shares on a touch device with Web Share", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        onSubmit={noop}
      />,
    );
    await submitOneSession();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /share to whatsapp/i }));
    expect(navigator.share).toHaveBeenCalledTimes(1);
    const text = (navigator.share as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(text).toContain("Alice 3");
    expect(text).toContain("Ladder: https://squash.example/");
  });

  it("includes the entered notes in the shared text", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        onSubmit={noop}
      />,
    );
    fireEvent.click(chip("Alice"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Alice" })).getByRole("button", {
        name: "3 wins",
      }),
    );
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Great squash today guys" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log Results" }));
    await screen.findByText(/session logged/i);

    fireEvent.click(screen.getByRole("button", { name: /share to whatsapp/i }));
    const text = (navigator.share as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .text;
    expect(text).toContain("Great squash today guys");
  });

  it("shows the success screen WITHOUT a Share button on desktop (fine pointer)", async () => {
    // Desktop browsers expose navigator.share but the share sheet can't reach the
    // WhatsApp group — so the button is hidden; the confirmation still shows.
    setEnv({ share: true, coarse: false });
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        onSubmit={noop}
      />,
    );
    await submitOneSession();
    expect(
      screen.queryByRole("button", { name: /share to whatsapp/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /view ladder/i }),
    ).toBeInTheDocument();
  });

  it("does not throw if Share is tapped twice while a share is pending", async () => {
    // Regression: navigator.share throws InvalidStateError if called again before
    // the previous call resolves. The handler must guard against that.
    let resolveShare: () => void = () => {};
    setEnv({ share: true, coarse: true });
    Object.defineProperty(navigator, "share", {
      value: vi.fn(() => new Promise<void>((r) => (resolveShare = r))),
      configurable: true,
    });
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        onSubmit={noop}
      />,
    );
    await submitOneSession();

    const share = screen.getByRole("button", { name: /share to whatsapp/i });
    fireEvent.click(share);
    fireEvent.click(share); // second tap before the first resolves
    expect(navigator.share).toHaveBeenCalledTimes(1);
    resolveShare();
  });

  it("never shows the share screen in edit mode (no ladderUrl)", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <SessionForm
        players={PLAYERS}
        initialSlots={[{ playerId: "p1", newName: "", wins: "3" }]}
        submitLabel="Save"
        onSubmit={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(screen.queryByText(/session logged/i)).toBeNull();
  });
});

describe("SessionForm draft autosave (step 28)", () => {
  const SLUG = "test-league";
  const KEY = `rungs-draft-${SLUG}`;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("autosaves entries + notes to localStorage on change (submit mode)", () => {
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        slug={SLUG}
        onSubmit={noop}
      />,
    );

    // Selecting a player adds an entry -> the autosave effect fires.
    fireEvent.click(chip("Alice"));
    const draft = JSON.parse(localStorage.getItem(KEY) ?? "null");
    expect(draft).not.toBeNull();
    expect(draft.entries).toHaveLength(1);
    expect(draft.entries[0]).toMatchObject({ playerId: "p1", wins: "0" });
    expect(draft.notes).toBe("");

    // Changing notes is persisted too.
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Tight games" },
    });
    const draft2 = JSON.parse(localStorage.getItem(KEY) ?? "null");
    expect(draft2.notes).toBe("Tight games");
  });

  it("restores entries + notes from localStorage on mount (submit mode)", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        entries: [{ key: 0, playerId: "p1", newName: "", wins: "3" }],
        notes: "Restored note",
      }),
    );

    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        slug={SLUG}
        onSubmit={noop}
      />,
    );

    // The restore runs in a mount effect (post-hydration), so wait for it.
    const block = await screen.findByRole("group", { name: "Alice" });
    expect(
      within(block).getByRole("button", { name: "3 wins" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(chip("Alice")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Notes")).toHaveValue("Restored note");
  });

  it("clears localStorage on a successful submit (submit mode)", async () => {
    render(
      <SessionForm
        players={PLAYERS}
        submitLabel="Log Results"
        ladderUrl="https://squash.example/"
        slug={SLUG}
        onSubmit={noop}
      />,
    );

    fireEvent.click(chip("Alice"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Alice" })).getByRole("button", {
        name: "3 wins",
      }),
    );
    expect(localStorage.getItem(KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Log Results" }));
    await screen.findByText(/session logged/i);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does NOT autosave in edit mode (initialSlots present)", () => {
    render(
      <SessionForm
        players={PLAYERS}
        initialSlots={[{ playerId: "p1", newName: "", wins: "3" }]}
        submitLabel="Save"
        slug={SLUG}
        onSubmit={noop}
        onDelete={noop}
      />,
    );

    // Change the wins on the pre-populated slot.
    fireEvent.click(
      within(screen.getByRole("group", { name: "Alice" })).getByRole("button", {
        name: "5 wins",
      }),
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
