import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import { ShareButton } from "./share-button";

const ROSTER = [
  { name: "Alice", wins: 3 },
  { name: "Bob", wins: 2 },
];

describe("ShareButton", () => {
  const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    if (originalShare) Object.defineProperty(navigator, "share", originalShare);
    else delete (navigator as unknown as { share?: unknown }).share;
    window.matchMedia = originalMatchMedia;
  });

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

  it("renders on a touch device (coarse pointer + Web Share API)", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <ShareButton roster={ROSTER} ladderUrl="https://squash.example/" />,
    );
    // canShare is checked in a mount effect (hydration-safe), so wait for it.
    expect(
      await screen.findByRole("button", { name: /^share$/i }),
    ).toBeInTheDocument();
  });

  it("is hidden on desktop (fine pointer)", () => {
    setEnv({ share: true, coarse: false });
    render(
      <ShareButton roster={ROSTER} ladderUrl="https://squash.example/" />,
    );
    expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
  });

  it("is hidden when the Web Share API is unavailable", () => {
    setEnv({ share: false, coarse: true });
    render(
      <ShareButton roster={ROSTER} ladderUrl="https://squash.example/" />,
    );
    expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
  });

  it("builds the share text from roster + ladderUrl and calls navigator.share", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <ShareButton roster={ROSTER} ladderUrl="https://squash.example/" />,
    );
    const btn = await screen.findByRole("button", { name: /^share$/i });
    fireEvent.click(btn);
    expect(navigator.share).toHaveBeenCalledTimes(1);
    const text = (navigator.share as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .text;
    expect(text).toContain("Scores: Alice 3, Bob 2");
    expect(text).toContain("Ladder: https://squash.example/");
  });

  it("includes notes in the share text when provided", async () => {
    setEnv({ share: true, coarse: true });
    render(
      <ShareButton
        roster={ROSTER}
        ladderUrl="https://squash.example/"
        notes="Great squash today"
      />,
    );
    const btn = await screen.findByRole("button", { name: /^share$/i });
    fireEvent.click(btn);
    const text = (navigator.share as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .text;
    expect(text).toContain("Great squash today");
  });
});
