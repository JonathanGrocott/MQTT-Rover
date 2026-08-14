const UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" }
] as const;

export function formatCompactCount(value: number): string {
  const safeValue = Math.max(0, Math.floor(value));
  const unit = UNITS.find((entry) => safeValue >= entry.threshold);
  if (!unit) {
    return safeValue.toLocaleString("en-US");
  }

  const scaled = safeValue / unit.threshold;
  const digits = scaled < 10 && !Number.isInteger(scaled) ? 1 : 0;
  return `${scaled.toFixed(digits).replace(/\.0$/, "")}${unit.suffix}`;
}

export function formatExactCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}
