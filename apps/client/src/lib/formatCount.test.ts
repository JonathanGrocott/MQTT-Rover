import { describe, expect, it } from "vitest";
import { formatCompactCount, formatExactCount } from "./formatCount";

describe("formatCompactCount", () => {
  it("keeps small counts exact", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("keeps large counters compact and stable", () => {
    expect(formatCompactCount(1_000)).toBe("1K");
    expect(formatCompactCount(1_250)).toBe("1.3K");
    expect(formatCompactCount(25_000)).toBe("25K");
    expect(formatCompactCount(1_500_000)).toBe("1.5M");
  });
});

describe("formatExactCount", () => {
  it("provides a readable exact value for tooltips", () => {
    expect(formatExactCount(1_234_567)).toBe("1,234,567");
  });
});
