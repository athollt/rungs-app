"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  elapsedMs,
  fastestLapIndex,
  formatDuration,
  lapRows,
  restoreOrDiscard,
  type TimerRun,
} from "@/lib/timer";

// Poolside stopwatch (step 30, ADR-017). Client-only: nothing here reaches Prisma
// or auth, and the archive is a phone screenshot rather than a database row. All
// derived values come from the pure helpers in lib/timer.ts — this component owns
// only the three effects (rAF, wake lock, localStorage).

// Key naming follows the `rungs-draft-{slug}` convention in SessionForm. The title
// is stored apart from the run so it survives a run being discarded as stale.
const RUN_KEY = "rungs-timer";
const TITLE_KEY = "rungs-timer-title";
const MAX_TITLE = 40;
// How long Reset stays armed after the first tap.
const CONFIRM_MS = 4000;

function readRun(): TimerRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerRun;
    // A half-written or hand-edited value must not wedge the page.
    if (typeof parsed?.startedAt !== "number") return null;
    if (!Array.isArray(parsed.lapMarks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRun(run: TimerRun | null) {
  if (typeof window === "undefined") return;
  if (run) window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
  else window.localStorage.removeItem(RUN_KEY);
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export function Stopwatch() {
  const [run, setRun] = useState<TimerRun | null>(null);
  const [title, setTitle] = useState("");
  // null until the mount effect runs, so the server-rendered shell (zeroed clock,
  // no date) matches the first client render — no hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const running = run !== null && run.stoppedAt === null;
  const stopped = run !== null && run.stoppedAt !== null;
  const idle = run === null;

  // Restore (once, post-mount): read the saved run and apply the 12-hour staleness
  // rule. Runs after hydration so the server HTML and first client render agree.
  useEffect(() => {
    const mountedAt = Date.now();
    const stored = readRun();
    const restored = restoreOrDiscard(stored, mountedAt);
    if (stored && !restored) writeRun(null);
    setNow(mountedAt);
    setRun(restored);
    setTitle(window.localStorage.getItem(TITLE_KEY) ?? "");
  }, []);

  // One clock, two jobs: rAF while a run is going (smooth hundredths), and a 1s
  // interval while idle (the date/time line is live until Start). A stopped run
  // needs neither — every value it shows is frozen.
  useEffect(() => {
    if (running) {
      let frame = requestAnimationFrame(function tick() {
        setNow(Date.now());
        frame = requestAnimationFrame(tick);
      });
      return () => cancelAnimationFrame(frame);
    }
    if (idle) {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
  }, [running, idle]);

  // Screen Wake Lock while timing. Browsers release the lock whenever the page
  // hides, so re-acquire on visibilitychange — without that the screen sleeps
  // again the moment after the first unlock, which is the whole point poolside.
  useEffect(() => {
    if (!running) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || wakeLock.current) return;
      if (document.visibilityState !== "visible") return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinel.addEventListener("release", () => {
          wakeLock.current = null;
        });
        wakeLock.current = sentinel;
      } catch {
        // Denied or unsupported. The timer stays correct; the screen just sleeps.
      }
    };

    void acquire();
    const onVisibilityChange = () => void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [running]);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  function persist(next: TimerRun | null) {
    setRun(next);
    writeRun(next);
  }

  function disarm() {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
  }

  function start() {
    const at = Date.now();
    setNow(at);
    persist({ startedAt: at, stoppedAt: null, lapMarks: [] });
  }

  function lap() {
    if (!running || !run) return;
    persist({ ...run, lapMarks: [...run.lapMarks, Date.now()] });
  }

  // Stop records the final lap and ends the run in one action — the last touch and
  // the end of the swim are the same event. There is no resume: only Reset clears
  // a finished run, so a stray tap cannot start over an un-screenshotted set.
  function stop() {
    if (!running || !run) return;
    const at = Date.now();
    setNow(at);
    persist({ ...run, stoppedAt: at, lapMarks: [...run.lapMarks, at] });
  }

  function reset() {
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), CONFIRM_MS);
      return;
    }
    disarm();
    persist(null);
    setNow(Date.now());
  }

  function changeTitle(value: string) {
    const next = value.slice(0, MAX_TITLE);
    setTitle(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TITLE_KEY, next);
    }
  }

  const rows = run ? lapRows(run) : [];
  const fastest = fastestLapIndex(rows);
  const elapsed = run && now !== null ? elapsedMs(run, now) : 0;
  // Live until Start, then frozen at the start timestamp: a screenshot should
  // record when the swim happened, not when the screenshot was taken.
  const clockLine = now === null ? " " : formatClock(run ? run.startedAt : now);

  return (
    <PageShell
      bottomGutter={false}
      title={
        <span className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="Untitled"
            aria-label="Session title"
            className="placeholder:text-muted-foreground/40 min-w-0 flex-1 truncate bg-transparent outline-none"
          />
          <Pencil aria-hidden className="text-muted-foreground/60 size-4 shrink-0" />
        </span>
      }
      subtitle={clockLine}
    >
      <div
        role="timer"
        aria-label="Elapsed time"
        className="text-center font-mono text-5xl font-bold tracking-tight tabular-nums"
      >
        {formatDuration(elapsed)}
      </div>

      {/* Lap is the only button pressed under time pressure, so it gets half the
          row. Start is disabled once stopped — Reset is the way out of a finished
          run, so a mistap cannot destroy a set before it has been screenshotted. */}
      <div className="mt-5 grid grid-cols-4 gap-2">
        <Button
          onClick={running ? stop : start}
          disabled={stopped}
          variant={running ? "secondary" : "default"}
          className="h-16"
        >
          {running ? "Stop" : "Start"}
        </Button>
        <Button
          onClick={lap}
          disabled={!running}
          className="col-span-2 h-16 text-base font-bold"
        >
          Lap
        </Button>
        <Button
          onClick={reset}
          disabled={idle}
          variant={armed ? "destructive" : stopped ? "default" : "outline"}
          className="h-16"
        >
          {armed ? "Sure?" : "Reset"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          {running ? "Tap Lap at each wall." : "Tap Start to begin."}
        </p>
      ) : (
        <Table className="mt-5">
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground w-8 px-2 text-xs font-medium">
                #
              </TableHead>
              <TableHead className="text-muted-foreground px-2 text-xs font-medium">
                Lap
              </TableHead>
              <TableHead className="text-muted-foreground px-2 text-right text-xs font-medium">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.index}>
                <TableCell className="text-muted-foreground px-2 py-1.5 text-xs">
                  {row.index}
                </TableCell>
                <TableCell
                  className={cn(
                    "px-2 py-1.5 font-mono tabular-nums",
                    row.index === fastest && "text-primary font-semibold",
                  )}
                >
                  {formatDuration(row.lapMs)}
                  {row.index === fastest && (
                    <span className="sr-only"> (fastest lap)</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatDuration(row.totalMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageShell>
  );
}
