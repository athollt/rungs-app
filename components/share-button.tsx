"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildShareText, type ShareRosterEntry } from "@/lib/share";

// Share a session result from the session history cards (step 28, extends
// ADR-009/016). Same Web Share API + `pointer: coarse` gate as the post-submit
// success screen in SessionForm: the desktop share sheet can't reach a WhatsApp
// group, so the button is hidden there. Public/ungated — the ladder is already
// public, anyone can share.
export function ShareButton({
  roster,
  ladderUrl,
  notes,
}: {
  roster: ShareRosterEntry[];
  ladderUrl: string;
  notes?: string;
}) {
  const sharing = useRef(false);
  // The canShare check reads navigator/window, which are client-only. Defer it
  // to after mount so the server renders null and the first client render
  // matches (no hydration mismatch). The button appears post-mount.
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-mount client-only check (hydration-safe; see ADR-009/016).
    setCanShare(
      typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)").matches === true,
    );
  }, []);

  if (!canShare) return null;

  const text = buildShareText({ roster, ladderUrl, notes });

  function handleShare() {
    if (sharing.current) return;
    sharing.current = true;
    Promise.resolve(navigator.share({ text }))
      .catch(() => {})
      .finally(() => {
        sharing.current = false;
      });
  }

  return (
    <Button type="button" variant="outline" onClick={handleShare}>
      Share
    </Button>
  );
}
