// data.js — DAMM funds data + metric formatting for the Telegram bot.
//
// Two sources, by design:
//   • Lagoon GraphQL  → price-per-share history → yields / share price /
//     max drawdown / % negative months (via the dashboard's tested core.js).
//   • DAMM Allocator  → CORRECT current composition (the Lagoon `composition`
//     field is deployed-only and incomplete). The allocator bundle is curated
//     from DeBank and deployed at dammallocator.vercel.app.
//
// All output is HTML (Telegram parse_mode 'HTML'); dynamic text is escaped.
'use strict';
const C = require('../core.js');

const LAGOON = 'https://api.lagoon.finance/query';

// Allocator (composition source). Override via env if needed.
const ALLOC_URL  = process.env.ALLOCATOR_URL  || 'https://dammallocator.vercel.app/data/funds-bundle.json';
const ALLOC_USER = process.env.ALLOCATOR_USER || 'damm';
const ALLOC_PASS = process.env.ALLOCATOR_PASS || 'nutria';

const FUNDS = {
  stable: { key:'stable', label:'DAMMstable', allocKey:'dammstable',
            address:'0xE5d6eb448Ac5A762C1ebE8cd1692b9CD08025176', chainId:42161, decimals:6, asset:'USDT0', chain:'Arbitrum' },
  if:     { key:'if', label:'DAMM-IF', note:'(DAMMeth)', allocKey:'dammeth',
            address:'0x3c63f3cE75dc83735745CF4e86B63414D95Ee355', chainId:1, decimals:18, asset:'WETH', chain:'Ethereum' },
};

// ---------- Lagoon (yields / price / drawdown / neg-months) ----------
const TTL = 60_000;
const lagoonCache = {};

async function fetchFund(key){
  const f = FUNDS[key];
  if (!f) throw new Error('Unknown fund: ' + key);
  const hit = lagoonCache[key];
  if (hit && Date.now() - hit.t < TTL) return hit.d;

  const q = `v: vaultByAddress(address:"${f.address.toLowerCase()}", chainId:${f.chainId}){
    name state{ pricePerShare } stateHistory{ pricePerShare(options:{}){ x y } }
  }`;
  const r = await fetch(LAGOON, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ query: `{ ${q} }` }) });
  if (!r.ok) throw new Error('Lagoon API HTTP ' + r.status);
  const j = await r.json();
  if (j.errors) throw new Error('Lagoon API error');
  const raw = j.data.v;
  if (!raw) throw new Error('No data for ' + f.label);

  const s = 10 ** f.decimals;
  const points = raw.stateHistory.pricePerShare.map(p => ({ x:p.x, y:Number(p.y)/s })).sort((a,b)=>a.x-b.x);
  const d = { f, name: raw.name, pps: Number(raw.state.pricePerShare)/s, points };
  lagoonCache[key] = { t: Date.now(), d };
  return d;
}

// ---------- Allocator (composition) ----------
const ALLOC_TTL = 5 * 60_000;
let allocCache = null;

async function fetchBundle(){
  if (allocCache && Date.now() - allocCache.t < ALLOC_TTL) return allocCache.b;
  const auth = 'Basic ' + Buffer.from(`${ALLOC_USER}:${ALLOC_PASS}`).toString('base64');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(ALLOC_URL, { headers:{ Authorization: auth }, signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return null;
    const b = await r.json();
    allocCache = { t: Date.now(), b };
    return b;
  } catch (e) { clearTimeout(to); return null; }
}

async function fetchAlloc(key){
  const f = FUNDS[key];
  const b = await fetchBundle();
  return (b && b[f.allocKey]) ? b[f.allocKey] : null;
}

// ---------- formatting ----------
const esc    = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pct    = x => x==null ? '—' : (x*100).toFixed(2)+'%';
const usd    = x => x==null ? '—' : '$'+Math.round(x).toLocaleString('en-US');
const dt     = t => new Date(t*1000).toISOString().slice(0,10);
const fmtPps = (x,dec) => x.toFixed(Math.min(dec,6));
const sharePct = (v,total) => total>0 ? (v/total*100).toFixed(1)+'%' : '—';

const lhdr = d => `📊 <b>${esc(d.name)}</b> — <i>${esc(d.f.asset)} · ${esc(d.f.chain)}</i>`;
const ahdr = (a,f) => `📊 <b>${esc((a&&a.fund&&a.fund.name)||f.label)}</b>`;

// --- Lagoon-backed metrics ---
function rYield(d,w){ return `${lhdr(d)}\n\n<b>Yield — ${w} days</b>\n${pct(C.trailingYield(d.points,w))}\n<i>trailing, annualized, net of fees</i>`; }

function rPrice(d){ const last=d.points[d.points.length-1];
  return `${lhdr(d)}\n\n<b>Last share price (NAV)</b>\n<code>${fmtPps(d.pps,d.f.decimals)} ${esc(d.f.asset)}</code>\n<i>as of ${dt(last.x)} · ${d.points.length} settlements</i>`; }

function rDrawdown(d){ const mdd=C.maxDrawdown(d.points);
  return `${lhdr(d)}\n\n<b>Maximum drawdown</b>\n${pct(mdd)}\n<i>worst peak-to-trough on settled NAV per share</i>`; }

function rNegMonths(d){
  const monthly = C.monthlyReturns(C.syntheticDaily(d.points), d.points[0].y);
  const complete = monthly.length > 1 ? monthly.slice(0, -1) : monthly; // drop current partial month
  const rets = complete.map(m => m.ret);
  const neg = rets.filter(r => r < 0).length;
  const p = rets.length ? neg/rets.length : null;
  return `${lhdr(d)}\n\n<b>% of negative months</b>\n${p==null?'—':(p*100).toFixed(1)+'%'}\n<i>${neg} of ${rets.length} complete months negative</i>`;
}

// --- Allocator-backed metrics ---
function rComposition(a,f){
  if (!a || !a.positions) return `📊 <b>${esc(f.label)}</b>\n\n<b>Composition</b> unavailable (allocator unreachable).`;
  const cur = a.positions.filter(p => p.status === 'current').sort((x,y)=>(y.amountUsd||0)-(x.amountUsd||0));
  const total = cur.reduce((s,p)=>s+(p.amountUsd||0),0);
  const asOf = a.fund && a.fund.asOf ? ` · as of ${esc(a.fund.asOf)}` : '';
  let out = `${ahdr(a,f)}\n\n<b>Current composition</b> — <i>NAV ${usd(total)}${asOf}</i>\n`;
  for (const p of cur){
    const apy = (p.apy!=null) ? ` · ${(+p.apy).toFixed(2)}% APY` : '';
    out += `\n<code>${sharePct(p.amountUsd,total).padStart(6)}</code>  ${esc(p.name||p.protocol)}  <i>${usd(p.amountUsd)}${apy}</i>`;
  }
  return out;
}

function rDecomposition(a,f){
  if (!a || !a.positions) return `📊 <b>${esc(f.label)}</b>\n\n<b>Decomposition</b> unavailable (allocator unreachable).`;
  const cur = a.positions.filter(p => p.status === 'current');
  const total = cur.reduce((s,p)=>s+(p.amountUsd||0),0);

  const byAsset = {};
  for (const p of cur) for (const u of (p.underlyingAssets||[])) byAsset[u.symbol] = (byAsset[u.symbol]||0) + (p.amountUsd||0)*(u.share||1);
  const byProto = {};
  for (const p of cur) for (const pr of (p.protocolExposures||[p.protocol])) byProto[pr] = (byProto[pr]||0) + (p.amountUsd||0);

  const fmtRows = obj => Object.entries(obj).sort((a,b)=>b[1]-a[1])
    .map(([n,v]) => `<code>${sharePct(v,total).padStart(6)}</code>  ${esc(n)}`).join('\n');

  const protoSum = Object.values(byProto).reduce((s,v)=>s+v,0);
  const lever = protoSum > total*1.05 ? '\n<i>(protocol exposure exceeds 100% — leveraged positions touch multiple protocols)</i>' : '';

  return `${ahdr(a,f)}\n\n<b>Decomposition</b> — <i>NAV ${usd(total)}</i>\n`+
    `\n<b>By underlying asset</b>\n${fmtRows(byAsset)||'—'}\n`+
    `\n<b>By protocol exposure</b>\n${fmtRows(byProto)||'—'}${lever}`;
}

// id -> { label, src ('lagoon'|'alloc'), fn }
const METRICS = {
  yield7:        { label:'📅 Yield 7d',       src:'lagoon', fn:d=>rYield(d,7) },
  yield30:       { label:'🗓 Yield 30d',       src:'lagoon', fn:d=>rYield(d,30) },
  composition:   { label:'🧩 Composition',     src:'alloc',  fn:rComposition },
  decomposition: { label:'🧬 Decomposition',   src:'alloc',  fn:rDecomposition },
  price:         { label:'💲 Share price',     src:'lagoon', fn:rPrice },
  drawdown:      { label:'📉 Max drawdown',    src:'lagoon', fn:rDrawdown },
  negmonths:     { label:'🔻 % neg months',    src:'lagoon', fn:rNegMonths },
};

async function metric(fundKey, id){
  const m = METRICS[id];
  if (!m) throw new Error('Unknown metric: ' + id);
  if (m.src === 'alloc') return m.fn(await fetchAlloc(fundKey), FUNDS[fundKey]);
  return m.fn(await fetchFund(fundKey));
}

module.exports = { FUNDS, METRICS, fetchFund, fetchAlloc, metric };
