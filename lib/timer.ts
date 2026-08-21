// Pure stopwatch logic (step 30, ADR-017). Framework-free and clock-injected, so
// every derived value is testable without timers. The client component owns only
// requestAnimationFrame, the wake lock, and localStorage.
//
// Every field is an absolute wall-clock timestamp rather than an accumulated
// duration. That is what makes a restored run correct with no bookkeeping: a run
// persisted mid-tick and reopened later re-derives its elapsed time from the same
// arithmetic, and a throttled or backgrounded tab cannot drift.

export interface TimerRun {
  startedAt: number; // epoch ms
  stoppedAt: number | null; // epoch ms once the run has ended
  lapMarks: number[]; // epoch ms, ascending; the last entry === stoppedAt when ended
}

export interface LapRow {
  index: number; // 1-based
  lapMs: number; // since the previous mark (or startedAt for lap 1)
  totalMs: number; // since startedAt
}

// A persisted run older than this is dropped on restore. Twelve hours covers
// "I forgot to screenshot it, let me get it after supper" while guaranteeing the
// app never opens onto yesterday's run still counting.
export const STALE_RUN_MS = 12 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, "0");

// mm:ss.hh, rolling to h:mm:ss.hh at exactly one hour. Hundredths (not tenths) is
// the swimming convention.
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms);
  const hundredths = Math.floor(total / 10) % 100;
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  const tail = `${pad2(seconds)}.${pad2(hundredths)}`;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${tail}`
    : `${pad2(minutes)}:${tail}`;
}

export function elapsedMs(run: TimerRun, now: number): number {
  return (run.stoppedAt ?? now) - run.startedAt;
}

export function lapRows(run: TimerRun): LapRow[] {
  return run.lapMarks.map((mark, i) => ({
    index: i + 1,
    lapMs: mark - (run.lapMarks[i - 1] ?? run.startedAt),
    totalMs: mark - run.startedAt,
  }));
}

// The 1-based index of the quickest lap, or null when there is nothing to compare
// against (a single lap is not "fastest"). Ties keep the earliest lap.
export function fastestLapIndex(rows: LapRow[]): number | null {
  if (rows.length < 2) return null;
  return rows.reduce((best, row) => (row.lapMs < best.lapMs ? row : best)).index;
}

// Aged against startedAt, not stoppedAt: a run left ticking overnight must be
// discarded rather than restored as a 14-hour ghost.
export function restoreOrDiscard(
  run: TimerRun | null,
  now: number,
): TimerRun | null {
  if (!run) return null;
  return now - run.startedAt > STALE_RUN_MS ? null : run;
}
