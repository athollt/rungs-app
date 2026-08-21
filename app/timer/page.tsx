import type { Metadata } from "next";
import { Stopwatch } from "@/components/stopwatch";

// Public, client-only stopwatch (step 30, ADR-017). Deliberately touches neither
// Prisma nor auth(): it reads nothing and stores nothing server-side, so it works
// signed out and offline. `isPublicRoute` in lib/auth-rules.ts lets it past the
// proxy; the header hamburger surfaces it for signed-in staff via nav.toolLinks().
// The bottom tab bar hides itself here because the path carries no league slug.
export const metadata: Metadata = {
  title: "Timer",
};

export default function TimerPage() {
  return <Stopwatch />;
}
