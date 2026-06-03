// core.js — pure data logic for the DAMM funds dashboard.
// No DOM, no fetch: loadable in the browser (window.DammCore) and in node (module.exports) for tests.
(function (global) {
  'use strict';

  const DAY = 86400; // seconds

  // Linear interpolation of a sorted [{x: unixSeconds, y: price}] series at time t.
  // Clamps outside the range (callers never sample outside [first, last]).
  function interpolateAt(points, t) {
    if (t <= points[0].x) return points[0].y;
    const last = points[points.length - 1];
    if (t >= last.x) return last.y;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].x <= t) lo = mid; else hi = mid;
    }
    const a = points[lo], b = points[hi];
    return a.y + (b.y - a.y) * (t - a.x) / (b.x - a.x);
  }

  // Synthetic daily series: price interpolated at every UTC midnight between the
  // first and last real datapoint. No extrapolation past the last settlement.
  function syntheticDaily(points) {
    const t0 = points[0].x, t1 = points[points.length - 1].x;
    const firstMidnight = Math.ceil(t0 / DAY) * DAY;
    const out = [];
    for (let t = firstMidnight; t <= t1; t += DAY) {
      out.push({ t, p: interpolateAt(points, t) });
    }
    return out;
  }

  function isUtcMonday(t) { return new Date(t * 1000).getUTCDay() === 1; }
  function isUtcFirstOfMonth(t) { return new Date(t * 1000).getUTCDate() === 1; }

  // Bucket boundaries over the synthetic daily timestamps.
  // granularity: 'daily' | 'weekly' | 'monthly'
  // mode: 'calendar' (Mon–Sun weeks / calendar months) | 'fixed' (7d/30d windows from series start)
  // Daily bars are mode-independent: every day is a boundary.
  function bucketBoundaries(days, granularity, mode) {
    if (granularity === 'daily') return days.slice();
    const first = days[0], last = days[days.length - 1];
    const bounds = [first];
    if (mode === 'fixed') {
      const step = (granularity === 'weekly' ? 7 : 30) * DAY;
      for (let t = first + step; t < last; t += step) bounds.push(t);
    } else {
      const isBoundary = granularity === 'weekly' ? isUtcMonday : isUtcFirstOfMonth;
      for (const t of days) {
        if (t > first && t < last && isBoundary(t)) bounds.push(t);
      }
    }
    bounds.push(last);
    return [...new Set(bounds)];
  }

  // APR bars: annualized simple return per bucket, (p1/p0 - 1) * 365/days.
  // Partial edge buckets annualize by their actual day count.
  function aprBars(series, granularity, mode) {
    const days = series.map(s => s.t);
    const priceAt = new Map(series.map(s => [s.t, s.p]));
    const bounds = bucketBoundaries(days, granularity, mode);
    const bars = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const t0 = bounds[i], t1 = bounds[i + 1];
      const nDays = (t1 - t0) / DAY;
      if (nDays <= 0) continue;
      const p0 = priceAt.get(t0), p1 = priceAt.get(t1);
      bars.push({ t0, t1, days: nDays, apr: (p1 / p0 - 1) * 365 / nDays });
    }
    return bars;
  }

  // Trailing (causal) rolling mean over `window` bars; null until the window fills.
  function rollingMean(values, window) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= window) sum -= values[i - window];
      if (i >= window - 1) out[i] = sum / window;
    }
    return out;
  }

  const api = { DAY, interpolateAt, syntheticDaily, bucketBoundaries, aprBars, rollingMean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DammCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
