import { describe, it, expect } from "vitest";
import {
  STALE_RUN_MS,
  elapsedMs,
  formatDuration,
  lapRows,
  lapSummary,
  paceDeviation,
  restoreOrDiscard,
  type TimerRun,
} from "@/lib/timer";

describe("formatDuration", () => {
  it("renders mm:ss.hh under an hour", () => {
    expect(formatDuration(0)).toBe("00:00.00");
    expect(formatDuration(999)).toBe("00:00.99");
    expect(formatDuration(1000)).toBe("00:01.00");
    expect(formatDuration(41_220)).toBe("00:41.22");
    expect(formatDuration(59_990)).toBe("00:59.99");
    expect(formatDuration(81_090)).toBe("01:21.09");
  });

  it("rolls to h:mm:ss.hh at exactly one hour", () => {
    expect(formatDuration(3_599_990)).toBe("59:59.99");
    expect(formatDuration(3_600_000)).toBe("1:00:00.00");
    expect(formatDuration(3_661_230)).toBe("1:01:01.23");
  });

  it("clamps a negative duration to zero", () => {
    expect(formatDuration(-500)).toBe("00:00.00");
  });
});

describe("elapsedMs", () => {
  const startedAt = 1_000_000;

  it("uses now while the run is going", () => {
    const run: TimerRun = { startedAt, stoppedAt: null, lapMarks: [] };
    expect(elapsedMs(run, startedAt + 4_200)).toBe(4_200);
  });

  it("freezes at stoppedAt once the run has ended", () => {
    const run: TimerRun = {
      startedAt,
      stoppedAt: startedAt + 9_000,
      lapMarks: [startedAt + 9_000],
    };
    expect(elapsedMs(run, startedAt + 999_999)).toBe(9_000);
  });
});

describe("lapRows", () => {
  const startedAt = 1_000_000;

  it("derives lap 1 from startedAt and later laps from the previous mark", () => {
    const run: TimerRun = {
      startedAt,
      stoppedAt: null,
      lapMarks: [startedAt + 41_220, startedAt + 81_090],
    };
    expect(lapRows(run)).toEqual([
      { index: 1, lapMs: 41_220, totalMs: 41_220 },
      { index: 2, lapMs: 39_870, totalMs: 81_090 },
    ]);
  });

  it("returns nothing before the first lap", () => {
    expect(lapRows({ startedAt, stoppedAt: null, lapMarks: [] })).toEqual([]);
  });
});

describe("lapSummary", () => {
  const rowsFor = (deltas: number[]) => {
    let t = 0;
    return lapRows({
      startedAt: 0,
      stoppedAt: null,
      lapMarks: deltas.map((d) => (t += d)),
    });
  };

  it("is null with fewer than two laps — nothing to summarise", () => {
    expect(lapSummary([])).toBeNull();
    expect(lapSummary(rowsFor([41_220]))).toBeNull();
  });

  it("reports median, spread, fastest, slowest and the bar scale", () => {
    // sorted: 37 640 · 39 870 · 41 220 · 44 150 → median = mean of the middle two
    expect(lapSummary(rowsFor([41_220, 39_870, 37_640, 44_150]))).toEqual({
      medianMs: 40_545,
      spreadMs: 6_510,
      fastestMs: 37_640,
      slowestMs: 44_150,
      // Real variation here, so the scale is the largest deviation, not the floor.
      barScaleMs: 3_605,
    });
  });

  // Without the floor a set this tight would still draw full-length bars, because
  // max-normalisation always makes the biggest deviation fill the width.
  it("floors the bar scale at 3% of the median for a very even set", () => {
    const summary = lapSummary(rowsFor([40_000, 40_050]));
    expect(summary?.medianMs).toBe(40_025);
    // largest deviation is 25ms, but 3% of the median is 1 200.75ms
    expect(summary?.barScaleMs).toBeCloseTo(1_200.75, 2);
  });

  it("takes the middle value outright when the lap count is odd", () => {
    expect(lapSummary(rowsFor([3_000, 1_000, 2_000]))?.medianMs).toBe(2_000);
  });

  // The median is the point of this centring: a dive makes lap 1 an outlier, and
  // a mean would be dragged toward it. Here the mean is 4 250 and the median 2 000.
  it("is not dragged by a single fast outlier the way a mean would be", () => {
    expect(lapSummary(rowsFor([100, 2_000, 2_100, 12_800]))?.medianMs).toBe(
      2_050,
    );
  });

  it("rounds a fractional median to whole milliseconds", () => {
    expect(lapSummary(rowsFor([1_000, 1_001]))?.medianMs).toBe(1_001);
  });
});

describe("paceDeviation", () => {
  const MEDIAN = 41_545;
  const MAX_ABS = 3_905;

  // The two-lap case: the median is exactly the midpoint, so both laps are always
  // equidistant from it. Only the floored scale stops a hundredth of a second
  // rendering as two full-length opposing bars.
  it("keeps a two-lap set honest when the laps are nearly identical", () => {
    const rows = lapRows({
      startedAt: 0,
      stoppedAt: null,
      lapMarks: [40_000, 80_050],
    });
    const summary = lapSummary(rows)!;
    const [first, second] = rows.map((r) =>
      paceDeviation(r.lapMs, summary.medianMs, summary.barScaleMs),
    );
    expect(first.side).toBe("faster");
    expect(second.side).toBe("slower");
    // 25ms against a 1 200.75ms scale — about 2%, not 100%.
    expect(first.percent).toBeCloseTo(2.08, 1);
    expect(second.percent).toBeCloseTo(2.08, 1);
  });

  it("still fills the width for a two-lap set that genuinely differs", () => {
    const rows = lapRows({
      startedAt: 0,
      stoppedAt: null,
      lapMarks: [40_000, 90_000],
    });
    const summary = lapSummary(rows)!;
    expect(
      paceDeviation(rows[1].lapMs, summary.medianMs, summary.barScaleMs).percent,
    ).toBe(100);
  });

  it("draws a faster lap to the right and a slower lap to the left", () => {
    expect(paceDeviation(37_640, MEDIAN, MAX_ABS)).toEqual({
      side: "faster",
      percent: 100,
      deltaMs: -3_905,
    });
    const slow = paceDeviation(44_150, MEDIAN, MAX_ABS);
    expect(slow.side).toBe("slower");
    expect(slow.deltaMs).toBe(2_605);
    expect(slow.percent).toBeCloseTo(66.71, 1);
  });

  it("reports a lap sitting exactly on the median as even, with no bar", () => {
    expect(paceDeviation(MEDIAN, MEDIAN, MAX_ABS)).toEqual({
      side: "even",
      percent: 0,
      deltaMs: 0,
    });
  });

  // A hundredth off the median must still read as off it, not as dead level.
  it("floors a tiny deviation so it does not vanish", () => {
    // 50 of 3 905 is 1.28%, below the floor.
    const tiny = paceDeviation(MEDIAN + 50, MEDIAN, MAX_ABS);
    expect(tiny.side).toBe("slower");
    expect(tiny.percent).toBe(2);
  });

  it("leaves a deviation already above the floor unclamped", () => {
    // 200 of 3 905 is 5.12%.
    expect(paceDeviation(MEDIAN + 200, MEDIAN, MAX_ABS).percent).toBeCloseTo(
      5.12,
      2,
    );
  });

  it("treats a set with no deviation at all as even", () => {
    expect(paceDeviation(40_000, 40_000, 0).side).toBe("even");
  });
});

describe("restoreOrDiscard", () => {
  const now = 1_700_000_000_000;
  const runStartedAgo = (ms: number): TimerRun => ({
    startedAt: now - ms,
    stoppedAt: null,
    lapMarks: [],
  });

  it("discards an absent run", () => {
    expect(restoreOrDiscard(null, now)).toBeNull();
  });

  it("restores a run started under 12 hours ago", () => {
    const run = runStartedAgo(STALE_RUN_MS - 60_000);
    expect(restoreOrDiscard(run, now)).toEqual(run);
  });

  it("discards a run started over 12 hours ago", () => {
    expect(restoreOrDiscard(runStartedAgo(STALE_RUN_MS + 60_000), now)).toBeNull();
  });

  // The age check is against startedAt, not stoppedAt, so a run left ticking
  // overnight is discarded rather than restored as a 14-hour ghost.
  it("ages a stopped run by its start, not its end", () => {
    const run: TimerRun = {
      startedAt: now - (STALE_RUN_MS + 60_000),
      stoppedAt: now - 1_000,
      lapMarks: [now - 1_000],
    };
    expect(restoreOrDiscard(run, now)).toBeNull();
  });
});
