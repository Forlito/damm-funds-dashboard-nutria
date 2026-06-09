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

  // ===========================================================================
  // Performance & risk metrics.
  //
  // CONVENTION: all return/risk statistics are computed on the *settlement* or a
  // *weekly-resampled* series — never on the dense interpolated daily series.
  // The daily series exists only to draw smooth lines. Settlements are ~weekly,
  // so daily interpolation introduces strong autocorrelation that fabricates a
  // smooth, low-variance path; volatility / Sharpe / Sortino computed on it are
  // smoothing-biased (understate risk, overstate ratios). Weekly resampling
  // matches the real settlement cadence and is the honest frequency.
  //
  // Annualization is calendar-based (365 days/year, √52 for weekly) — correct
  // for a 24/7 on-chain fund, not the 252 trading-day TradFi convention.
  // ===========================================================================

  const WEEK = 7 * DAY;
  const YEAR_DAYS = 365;

  // Total compounded return between the first and last real settlement points.
  function cumulativeReturn(points) {
    return points[points.length - 1].y / points[0].y - 1;
  }

  // CAGR: constant annual growth rate reproducing the end value (geometric).
  function cagr(points) {
    const p0 = points[0], pN = points[points.length - 1];
    const years = (pN.x - p0.x) / DAY / YEAR_DAYS;
    if (years <= 0) return 0;
    return Math.pow(pN.y / p0.y, 1 / years) - 1;
  }

  // Trailing annualized yield over a lookback window (the Superstate/Ondo "30-day
  // yield" form): (P_end / P_start)^(365/d) − 1, net of fees (PPS is already net).
  // Returns null if the series is shorter than the window.
  function trailingYield(points, lookbackDays) {
    const last = points[points.length - 1];
    const start = last.x - lookbackDays * DAY;
    if (start < points[0].x) return null;
    const pStart = interpolateAt(points, start);
    const d = lookbackDays;
    return Math.pow(last.y / pStart, YEAR_DAYS / d) - 1;
  }

  // Resample a series to a fixed step (default weekly) anchored at the series
  // start, inclusive of the final real point. Used as the honest frequency for
  // risk stats. Input/output: [{x|t, y|p}]; accepts either key shape.
  function resample(series, stepDays = 7) {
    const pts = series.map(s => ({ x: s.x ?? s.t, y: s.y ?? s.p }));
    const t0 = pts[0].x, tN = pts[pts.length - 1].x;
    const step = stepDays * DAY;
    const out = [];
    for (let t = t0; t < tN; t += step) out.push({ x: t, y: interpolateAt(pts, t) });
    out.push({ x: tN, y: pts[pts.length - 1].y });
    return out;
  }

  // Simple periodic returns r_i = P_i/P_{i-1} − 1 from a [{x,y}] series.
  function simpleReturns(series) {
    const r = [];
    for (let i = 1; i < series.length; i++) r.push(series[i].y / series[i - 1].y - 1);
    return r;
  }

  // Sample standard deviation (n−1).
  function stdev(xs) {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  // Annualized volatility: stdev(periodic returns) × √(periodsPerYear).
  function annualizedVol(returns, periodsPerYear = 52) {
    return stdev(returns) * Math.sqrt(periodsPerYear);
  }

  // Sharpe on per-period excess returns, then annualized. rfAnnual is the annual
  // risk-free rate (e.g. an on-chain money-market proxy); converted per-period.
  function sharpe(returns, rfAnnual = 0, periodsPerYear = 52) {
    if (returns.length < 2) return null;
    const rfPer = rfAnnual / periodsPerYear;
    const excess = returns.map(r => r - rfPer);
    const sd = stdev(excess);
    if (sd === 0) return null; // near-monotonic series → undefined (stable vault)
    const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
    return (mean / sd) * Math.sqrt(periodsPerYear);
  }

  // Sortino: excess return over downside deviation. Downside deviation divides by
  // ALL n periods (zeros for upside), per the standard definition. mar = minimum
  // acceptable annual return.
  function sortino(returns, marAnnual = 0, periodsPerYear = 52) {
    if (returns.length < 2) return null;
    const marPer = marAnnual / periodsPerYear;
    const excess = returns.map(r => r - marPer);
    const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
    const downSq = excess.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / excess.length;
    const dd = Math.sqrt(downSq);
    if (dd === 0) return null;
    return (mean / dd) * Math.sqrt(periodsPerYear);
  }

  // Drawdown series DD_t = P_t/running_peak − 1 (≤ 0). Input accepts {x,y}|{t,p}.
  function drawdownSeries(series) {
    let peak = -Infinity;
    return series.map(s => {
      const x = s.x ?? s.t, y = s.y ?? s.p;
      if (y > peak) peak = y;
      return { t: x, dd: y / peak - 1 };
    });
  }

  function maxDrawdown(series) {
    return drawdownSeries(series).reduce((m, d) => Math.min(m, d.dd), 0);
  }

  function currentDrawdown(series) {
    const dd = drawdownSeries(series);
    return dd[dd.length - 1].dd;
  }

  // Longest underwater stretch in days: max span from a peak until the series
  // first regains it. Returns { days, ongoing } (ongoing = still underwater now).
  function longestUnderwater(series) {
    const pts = series.map(s => ({ x: s.x ?? s.t, y: s.y ?? s.p }));
    let peak = pts[0].y, peakT = pts[0].x, longest = 0, ongoing = false;
    for (const p of pts) {
      if (p.y >= peak) { peak = p.y; peakT = p.x; }
      else {
        const span = (p.x - peakT) / DAY;
        if (span > longest) { longest = span; ongoing = (p === pts[pts.length - 1]); }
      }
    }
    return { days: longest, ongoing };
  }

  // Monthly returns from the synthetic daily series. Each month's return chains
  // off the prior month-end PPS; the first month chains off `basePrice` (the
  // inception price). The final month is partial (month-to-date). Returns
  // [{ year, month (0-11), ret, t }] in chronological order.
  function monthlyReturns(daily, basePrice) {
    if (!daily.length) return [];
    const monthEnds = new Map(); // "year-month" -> {year, month, p, t}
    for (const s of daily) {
      const d = new Date(s.t * 1000);
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth();
      monthEnds.set(key, { year: d.getUTCFullYear(), month: d.getUTCMonth(), p: s.p, t: s.t });
    }
    const ordered = [...monthEnds.values()].sort((a, b) => a.t - b.t);
    const out = [];
    let prev = basePrice;
    for (const m of ordered) {
      out.push({ year: m.year, month: m.month, ret: m.p / prev - 1, t: m.t });
      prev = m.p;
    }
    return out;
  }

  // Pivot monthly returns into table rows: [{ year, months:[12 nullable], ytd }].
  function monthlyTable(monthly) {
    const byYear = new Map();
    for (const m of monthly) {
      if (!byYear.has(m.year)) byYear.set(m.year, new Array(12).fill(null));
      byYear.get(m.year)[m.month] = m.ret;
    }
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, months]) => {
      const present = months.filter(x => x != null);
      const ytd = present.reduce((acc, r) => acc * (1 + r), 1) - 1;
      return { year, months, ytd: present.length ? ytd : null };
    });
  }

  // Share of strictly-positive periods.
  function positiveRate(returns) {
    if (!returns.length) return null;
    return returns.filter(r => r > 0).length / returns.length;
  }

  function bestWorst(returns) {
    if (!returns.length) return { best: null, worst: null };
    return { best: Math.max(...returns), worst: Math.min(...returns) };
  }

  // Trailing rolling annualized yield over `windowDays`, sampled along the daily
  // series. [{ t, apy }] with apy null until the window fills.
  function rollingYieldSeries(daily, windowDays) {
    const pts = daily.map(s => ({ x: s.t, y: s.p }));
    return daily.map(s => {
      const start = s.t - windowDays * DAY;
      if (start < pts[0].x) return { t: s.t, apy: null };
      const pStart = interpolateAt(pts, start);
      return { t: s.t, apy: Math.pow(s.p / pStart, YEAR_DAYS / windowDays) - 1 };
    });
  }

  // Growth-of-100 index from a daily series: 100 × P_t/P_0.
  function growthOf100(daily) {
    const p0 = daily[0].p;
    return daily.map(s => ({ t: s.t, v: 100 * s.p / p0 }));
  }

  const api = {
    DAY, WEEK, YEAR_DAYS, interpolateAt, syntheticDaily, bucketBoundaries, aprBars, rollingMean,
    cumulativeReturn, cagr, trailingYield, resample, simpleReturns, stdev, annualizedVol,
    sharpe, sortino, drawdownSeries, maxDrawdown, currentDrawdown, longestUnderwater,
    monthlyReturns, monthlyTable, positiveRate, bestWorst, rollingYieldSeries, growthOf100,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DammCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
