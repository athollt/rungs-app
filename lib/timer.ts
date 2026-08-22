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

export interface LapSummary {
  // The pace bars centre on the MEDIAN, not the mean. A racing dive makes lap 1
  // structurally faster than any swum lap, and a mean is dragged down by it —
  // enough to recolour mid-set laps as "slower than average" when they are level
  // with the swimmer's actual pace. The median is simply robust to that outlier;
  // it is not a dive-specific correction.
  medianMs: number;
  spreadMs: number;
  fastestMs: number;
  slowestMs: number;
  // Largest absolute distance from the median — the scale the bars divide by.
  maxAbsDeviationMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Null below two laps — one lap has nothing to be fast or slow relative to.
// Spread (slowest minus fastest) is the pacing number: whether the set held
// together or came apart.
export function lapSummary(rows: LapRow[]): LapSummary | null {
  if (rows.length < 2) return null;
  const times = rows.map((r) => r.lapMs);
  const fastestMs = Math.min(...times);
  const slowestMs = Math.max(...times);
  const medianMs = median(times);
  return {
    medianMs,
    spreadMs: slowestMs - fastestMs,
    fastestMs,
    slowestMs,
    maxAbsDeviationMs: Math.max(...times.map((t) => Math.abs(t - medianMs))),
  };
}

// Smallest visible bar, as a percentage of the half-width. Without it a lap a
// tenth off the median renders as a hairline indistinguishable from dead level.
const PACE_BAR_MIN_PERCENT = 2;

export interface PaceDeviation {
  // Which way the bar grows from the centre line. "faster" draws right, "slower"
  // draws left — direction carries the meaning independently of colour, so the
  // red/green reading survives colour blindness.
  side: "faster" | "slower" | "even";
  // Share of the half-width, 0-100.
  percent: number;
  // Signed distance from the median; negative is faster.
  deltaMs: number;
}

// A lap as its distance from the median, rather than its absolute length. This
// makes the SHAPE of a set legible at a glance — a green block giving way to red
// down the page is a swimmer fading — which comparing ten similar bar lengths
// does not. The cost is half the horizontal resolution per bar.
export function paceDeviation(
  lapMs: number,
  medianMs: number,
  maxAbsDeviationMs: number,
): PaceDeviation {
  const deltaMs = lapMs - medianMs;
  if (deltaMs === 0 || maxAbsDeviationMs <= 0) {
    return { side: "even", percent: 0, deltaMs: 0 };
  }
  const scaled = (Math.abs(deltaMs) / maxAbsDeviationMs) * 100;
  return {
    side: deltaMs < 0 ? "faster" : "slower",
    percent: Math.max(PACE_BAR_MIN_PERCENT, scaled),
    deltaMs,
  };
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
