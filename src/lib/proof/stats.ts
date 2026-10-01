/**
 * The little statistics PROOF is allowed to use (Phase 38O). Medians and
 * spreads, never means of skewed things, and never a p-value dressed up as
 * a verdict. Pure.
 */

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values: number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return v[lo];
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/**
 * Median absolute deviation, scaled so it reads like a standard deviation
 * on normal-ish data (× 1.4826). Zero when nothing varies.
 */
export function spread(values: number[]): number | null {
  const m = median(values);
  if (m == null) return null;
  const dev = median(values.map((x) => Math.abs(x - m)));
  return dev == null ? null : dev * 1.4826;
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
