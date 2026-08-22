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

// A signed distance from the median, compact enough to sit beside a bar: "+1.23",
// "-0.42", "0.00". Drops the leading minutes unless the gap is genuinely over a
// minute, which on a lap split it almost never is.
export function formatDelta(deltaMs: number): string {
  if (deltaMs === 0) return "0.00";
  const sign = deltaMs < 0 ? "-" : "+";
  const abs = Math.abs(deltaMs);
  const hundredths = Math.floor(abs / 10) % 100;
  const seconds = Math.floor(abs / 1000) % 60;
  const minutes = Math.floor(abs / 60_000);
  return minutes > 0
    ? `${sign}${minutes}:${pad2(seconds)}.${pad2(hundredths)}`
    : `${sign}${seconds}.${pad2(hundredths)}`;
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
  // What the bars divide by. Normally the largest distance from the median, so a
  // set uses the full width — but floored at a fraction of the median, because
  // pure max-normalisation has no sense of scale: two laps a hundredth apart
  // would each draw a full-length bar in opposite directions and imply a gulf
  // that isn't there. The floor keeps a tight set drawing short bars. It bites
  // hardest at two laps, where the median is exactly the midpoint and the two
  // deviations are always equal and opposite.
  barScaleMs: number;
}

// The denominator floor, as a share of the median lap. Below this much variation
// a set is "even" and should look it.
const PACE_SCALE_MIN_FRACTION = 0.03;

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
  const maxAbsDeviation = Math.max(
    ...times.map((t) => Math.abs(t - medianMs)),
  );
  return {
    medianMs,
    spreadMs: slowestMs - fastestMs,
    fastestMs,
    slowestMs,
    barScaleMs: Math.max(maxAbsDeviation, medianMs * PACE_SCALE_MIN_FRACTION),
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
  barScaleMs: number,
): PaceDeviation {
  const deltaMs = lapMs - medianMs;
  // An odd lap count always puts one lap exactly on the median. It draws no bar,
  // so the row must show the centre marker instead — otherwise it reads as a
  // failed render rather than as the reference the other bars are measured from.
  if (deltaMs === 0 || barScaleMs <= 0) {
    return { side: "even", percent: 0, deltaMs: 0 };
  }
  const scaled = (Math.abs(deltaMs) / barScaleMs) * 100;
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
