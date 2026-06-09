// test.js — sanity tests for core.js. Run: node test.js
'use strict';
const {
  DAY, interpolateAt, syntheticDaily, bucketBoundaries, aprBars, rollingMean,
  cumulativeReturn, cagr, trailingYield, resample, simpleReturns, stdev, annualizedVol,
  sharpe, sortino, drawdownSeries, maxDrawdown, currentDrawdown, longestUnderwater,
  monthlyReturns, monthlyTable, positiveRate, bestWorst, rollingYieldSeries, growthOf100,
} = require('./core.js');

let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error(`FAIL  ${name}`); }
  else console.log(`ok    ${name}`);
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// --- interpolateAt ---
{
  const pts = [{ x: 0, y: 1 }, { x: 10 * DAY, y: 2 }];
  check('interp midpoint', approx(interpolateAt(pts, 5 * DAY), 1.5));
  check('interp clamps left', approx(interpolateAt(pts, -DAY), 1));
  check('interp clamps right', approx(interpolateAt(pts, 11 * DAY), 2));
  const pts3 = [{ x: 0, y: 1 }, { x: DAY, y: 1.1 }, { x: 3 * DAY, y: 1.3 }];
  check('interp picks correct segment', approx(interpolateAt(pts3, 2 * DAY), 1.2));
}

// --- syntheticDaily ---
{
  // first point at 06:00 day 0, last at 12:00 day 10 -> midnights day1..day10 = 10 samples
  const pts = [{ x: 6 * 3600, y: 1 }, { x: 10 * DAY + 12 * 3600, y: 2 }];
  const s = syntheticDaily(pts);
  check('synthetic count', s.length === 10);
  check('synthetic starts at first midnight after t0', s[0].t === DAY);
  check('synthetic does not extrapolate', s[s.length - 1].t <= pts[1].x);
  // monotone increasing prices for a monotone series
  check('synthetic monotone', s.every((d, i) => i === 0 || d.p > s[i - 1].p));
  // exact midnight first point is included
  const s2 = syntheticDaily([{ x: DAY, y: 1 }, { x: 3 * DAY, y: 1.2 }]);
  check('synthetic includes exact-midnight endpoint', s2[0].t === DAY && s2.length === 3);
}

// --- aprBars daily: constant arithmetic growth ---
{
  // p grows +0.001 absolute per day from 1.0 -> daily return varies slightly, apr_day0 = 0.001*365
  const series = Array.from({ length: 11 }, (_, i) => ({ t: i * DAY, p: 1 + 0.001 * i }));
  const bars = aprBars(series, 'daily', 'calendar');
  check('daily bar count', bars.length === 10);
  check('daily bar apr', approx(bars[0].apr, 0.001 * 365));
  check('daily bars are 1 day', bars.every(b => b.days === 1));
  // mode-independence for daily
  const barsF = aprBars(series, 'daily', 'fixed');
  check('daily mode-independent', JSON.stringify(bars) === JSON.stringify(barsF));
}

// --- weekly calendar boundaries land on Mondays ---
{
  // 2026-06-03 is a Wednesday. 30 days of data.
  const start = Date.UTC(2026, 5, 3) / 1000;
  const series = Array.from({ length: 30 }, (_, i) => ({ t: start + i * DAY, p: 1 + 0.0001 * i }));
  const bounds = bucketBoundaries(series.map(s => s.t), 'weekly', 'calendar');
  const inner = bounds.slice(1, -1);
  check('weekly inner bounds are Mondays', inner.length > 0 && inner.every(t => new Date(t * 1000).getUTCDay() === 1));
  check('weekly bounds start/end at series edges', bounds[0] === series[0].t && bounds[bounds.length - 1] === series[29].t);
  const bars = aprBars(series, 'weekly', 'calendar');
  check('weekly partial edge buckets < 7 days', bars[0].days < 7 && bars[bars.length - 1].days <= 7);
  check('weekly full buckets are 7 days', bars.slice(1, -1).every(b => b.days === 7));
  // bars chain with no gaps
  check('weekly bars contiguous', bars.every((b, i) => i === 0 || b.t0 === bars[i - 1].t1));
}

// --- monthly calendar boundaries land on the 1st ---
{
  const start = Date.UTC(2026, 0, 15) / 1000; // Jan 15
  const series = Array.from({ length: 90 }, (_, i) => ({ t: start + i * DAY, p: 1 + 0.0001 * i }));
  const bounds = bucketBoundaries(series.map(s => s.t), 'monthly', 'calendar');
  const inner = bounds.slice(1, -1);
  check('monthly inner bounds are 1sts', inner.length > 0 && inner.every(t => new Date(t * 1000).getUTCDate() === 1));
}

// --- fixed mode: 7d windows anchored at start ---
{
  const start = Date.UTC(2026, 5, 3) / 1000;
  const series = Array.from({ length: 25 }, (_, i) => ({ t: start + i * DAY, p: 1 + 0.0001 * i }));
  const bars = aprBars(series, 'weekly', 'fixed');
  check('fixed weekly full bars are 7d', bars.slice(0, -1).every(b => b.days === 7));
  check('fixed weekly trailing partial', bars[bars.length - 1].days === 24 - 21);
  const barsM = aprBars(series, 'monthly', 'fixed');
  check('fixed monthly is 30d windows', barsM.length === 1 && barsM[0].days === 24);
}

// --- annualization correctness on a known series ---
{
  // exactly +1% over 73 days -> apr = 0.01 * 365/73 = 5%
  const series = Array.from({ length: 74 }, (_, i) => ({ t: i * DAY, p: 1 + 0.01 * i / 73 }));
  const bars = aprBars(series, 'monthly', 'fixed'); // 30,30,13 day buckets
  const total = bars.reduce((acc, b) => acc * (1 + b.apr * b.days / 365), 1);
  check('bucket APRs recompose to total return', approx(total, 1.01, 1e-12));
}

// --- rollingMean ---
{
  const rm = rollingMean([1, 2, 3, 4, 5], 3);
  check('rolling nulls before window fills', rm[0] === null && rm[1] === null);
  check('rolling values', approx(rm[2], 2) && approx(rm[3], 3) && approx(rm[4], 4));
  const rm1 = rollingMean([5, 7], 1);
  check('rolling window=1 is identity', approx(rm1[0], 5) && approx(rm1[1], 7));
}

// --- cumulativeReturn / cagr ---
{
  const pts = [{ x: 0, y: 1 }, { x: YEARp(1), y: 1.1 }];
  check('cumulativeReturn basic', approx(cumulativeReturn(pts), 0.1));
  // exactly +21% over 2 years -> cagr = 1.21^(1/2)-1 = 0.1
  const pts2 = [{ x: 0, y: 1 }, { x: YEARp(2), y: 1.21 }];
  check('cagr two-year', approx(cagr(pts2), 0.1, 1e-9));
  // single-day +1% annualizes huge but finite
  check('cagr positive', cagr([{ x: 0, y: 1 }, { x: 10 * DAY, y: 1.01 }]) > 0);
}
function YEARp(n) { return Math.round(n * 365) * DAY; }

// --- trailingYield ---
{
  // +1% over the trailing 30 days -> (1.01)^(365/30)-1
  const pts = [{ x: 0, y: 1 }, { x: 100 * DAY, y: 1.05 }, { x: 130 * DAY, y: 1.05 * 1.01 }];
  const ty = trailingYield(pts, 30);
  check('trailingYield 30d', approx(ty, Math.pow(1.01, 365 / 30) - 1, 1e-9));
  check('trailingYield null when too short', trailingYield([{ x: 0, y: 1 }, { x: 5 * DAY, y: 1.01 }], 30) === null);
}

// --- resample + simpleReturns ---
{
  const daily = Array.from({ length: 22 }, (_, i) => ({ t: i * DAY, p: 1 + 0.001 * i }));
  const wk = resample(daily, 7);
  check('resample weekly steps', wk[1].x - wk[0].x === 7 * DAY);
  check('resample includes last point', wk[wk.length - 1].x === 21 * DAY);
  const r = simpleReturns([{ x: 0, y: 1 }, { x: 1, y: 1.1 }, { x: 2, y: 1.21 }]);
  check('simpleReturns', approx(r[0], 0.1) && approx(r[1], 0.1));
}

// --- stdev / annualizedVol ---
{
  check('stdev known', approx(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395, 1e-9));
  check('stdev single', stdev([5]) === 0);
  check('annualizedVol scales by sqrt', approx(annualizedVol([0.01, -0.01, 0.01, -0.01], 52), stdev([0.01, -0.01, 0.01, -0.01]) * Math.sqrt(52)));
}

// --- sharpe / sortino ---
{
  const r = [0.01, 0.02, -0.005, 0.015, 0.0];
  const sh = sharpe(r, 0, 52);
  check('sharpe finite', sh !== null && isFinite(sh));
  // monotone series (no variance in excess) -> null
  check('sharpe null on zero-vol', sharpe([0.01, 0.01, 0.01], 0, 52) === null);
  const so = sortino(r, 0, 52);
  check('sortino finite', so !== null && isFinite(so));
  // all-positive returns -> no downside -> null
  check('sortino null when no downside', sortino([0.01, 0.02, 0.03], 0, 52) === null);
  // sortino >= sharpe magnitude when downside dev < total dev (typical for upside-skewed)
  check('sortino defined sign', so > 0);
}

// --- drawdown family ---
{
  const series = [{ t: 0, p: 1 }, { t: DAY, p: 1.1 }, { t: 2 * DAY, p: 0.99 }, { t: 3 * DAY, p: 1.2 }];
  check('maxDrawdown', approx(maxDrawdown(series), 0.99 / 1.1 - 1));
  check('currentDrawdown zero at new high', approx(currentDrawdown(series), 0));
  const uw = longestUnderwater(series);
  check('longestUnderwater days', uw.days === 1 && uw.ongoing === false);
  // monotone-up series -> zero drawdown
  check('no drawdown when monotone', maxDrawdown([{ t: 0, p: 1 }, { t: DAY, p: 1.1 }]) === 0);
}

// --- monthlyReturns / monthlyTable ---
{
  // build a daily series spanning Jan 15 2026 -> Mar 10 2026, +0.1%/day
  const start = Date.UTC(2026, 0, 15) / 1000;
  const daily = Array.from({ length: 55 }, (_, i) => ({ t: start + i * DAY, p: 1 * Math.pow(1.001, i) }));
  const m = monthlyReturns(daily, daily[0].p);
  check('monthlyReturns has 3 months', m.length === 3 && m[0].month === 0 && m[2].month === 2);
  // chained returns recompose to total (within the daily series)
  const total = m.reduce((acc, x) => acc * (1 + x.ret), 1);
  check('monthly returns chain to total', approx(total, daily[daily.length - 1].p / daily[0].p, 1e-9));
  const table = monthlyTable(m);
  check('monthlyTable one year row', table.length === 1 && table[0].year === 2026);
  check('monthlyTable ytd geometric', approx(table[0].ytd, total - 1, 1e-9));
  check('monthlyTable nulls absent months', table[0].months[5] === null);
}

// --- positiveRate / bestWorst ---
{
  check('positiveRate', approx(positiveRate([0.1, -0.1, 0.2, 0]), 0.5));
  const bw = bestWorst([0.1, -0.2, 0.05]);
  check('bestWorst', approx(bw.best, 0.1) && approx(bw.worst, -0.2));
}

// --- rollingYieldSeries / growthOf100 ---
{
  const daily = Array.from({ length: 40 }, (_, i) => ({ t: i * DAY, p: Math.pow(1.0005, i) }));
  const ry = rollingYieldSeries(daily, 7);
  check('rollingYield null before window', ry[0].apy === null);
  check('rollingYield filled after window', ry[39].apy !== null && ry[39].apy > 0);
  const g = growthOf100(daily);
  check('growthOf100 starts at 100', approx(g[0].v, 100));
  check('growthOf100 tracks ratio', approx(g[39].v, 100 * daily[39].p / daily[0].p));
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
