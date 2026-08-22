import { describe, it, expect } from "vitest";
import {
  STALE_RUN_MS,
  elapsedMs,
  fastestLapIndex,
  formatDuration,
  lapRows,
  lapSummary,
  paceBarPercent,
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

describe("fastestLapIndex", () => {
  const startedAt = 0;
  const rowsFor = (marks: number[]) =>
    lapRows({ startedAt, stoppedAt: null, lapMarks: marks });

  it("is null with fewer than two laps", () => {
    expect(fastestLapIndex([])).toBeNull();
    expect(fastestLapIndex(rowsFor([5_000]))).toBeNull();
  });

  it("returns the 1-based index of the quickest lap", () => {
    // laps of 5.0s, 3.0s, 4.0s
    expect(fastestLapIndex(rowsFor([5_000, 8_000, 12_000]))).toBe(2);
  });

  it("keeps the earliest lap on a tie", () => {
    // laps of 3.0s, 3.0s
    expect(fastestLapIndex(rowsFor([3_000, 6_000]))).toBe(1);
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

  it("reports average, spread, fastest and slowest", () => {
    expect(lapSummary(rowsFor([41_220, 39_870, 37_640, 44_150]))).toEqual({
      averageMs: 40_720,
      spreadMs: 6_510,
      fastestMs: 37_640,
      slowestMs: 44_150,
    });
  });

  it("rounds a fractional average to whole milliseconds", () => {
    expect(lapSummary(rowsFor([1_000, 1_001]))?.averageMs).toBe(1_001);
  });
});

describe("paceBarPercent", () => {
  it("puts the fastest lap at the floor and the slowest at full width", () => {
    expect(paceBarPercent(37_640, 37_640, 44_150)).toBe(30);
    expect(paceBarPercent(44_150, 37_640, 44_150)).toBe(100);
  });

  it("places a mid lap proportionally between them", () => {
    expect(paceBarPercent(40_895, 37_640, 44_150)).toBeCloseTo(65, 5);
  });

  // Every lap identical (or a single lap) has no range to scale across.
  it("is full width when there is no spread", () => {
    expect(paceBarPercent(40_000, 40_000, 40_000)).toBe(100);
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
