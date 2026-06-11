// data.js — DAMM funds data + metric formatting for the Telegram bot.
//
// Reuses the dashboard's tested metric engine (../core.js) so the bot and the
// dashboard always report identical numbers. All output is HTML (Telegram
// parse_mode: 'HTML') — dynamic text is escaped via esc().
'use strict';
const C = require('../core.js');

const API = 'https://api.lagoon.finance/query';

// The two funds. Keys match the user's vocabulary: "stable" and "if".
const FUNDS = {
  stable: { key:'stable', label:'DAMMstable', address:'0xE5d6eb448Ac5A762C1ebE8cd1692b9CD08025176',
            chainId:42161, decimals:6, asset:'USDT0', chain:'Arbitrum' },
  if:     { key:'if', label:'DAMM-IF', note:'(DAMMeth)', address:'0x3c63f3cE75dc83735745CF4e86B63414D95Ee355',
            chainId:1, decimals:18, asset:'WETH', chain:'Ethereum', tvlInNative:true },
};

// 60s per-fund cache so rapid button taps don't hammer the API.
const TTL = 60_000;
const cache = {};

async function fetchFund(key){
  const f = FUNDS[key];
  if (!f) throw new Error('Unknown fund: ' + key);
  const hit = cache[key];
  if (hit && Date.now() - hit.t < TTL) return hit.d;

  const q = `v: vaultByAddress(address:"${f.address.toLowerCase()}", chainId:${f.chainId}){
    name symbol
    state{ pricePerShare totalAssets totalAssetsUsd totalSupply managementFee performanceFee }
    stateHistory{ pricePerShare(options:{}){ x y } }
    composition{ totalValueInUsd
      tokenCompositions{ symbol name repartition valueInUsd }
      compositions{ protocol repartition valueInUsd } }
  }`;
  const r = await fetch(API, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ query: `{ ${q} }` }) });
  if (!r.ok) throw new Error('Lagoon API HTTP ' + r.status);
  const j = await r.json();
  if (j.errors) throw new Error('Lagoon API error');
  const raw = j.data.v;
  if (!raw) throw new Error('No data for ' + f.label);

  const s = 10 ** f.decimals;
  const points = raw.stateHistory.pricePerShare
    .map(p => ({ x:p.x, y:Number(p.y)/s })).sort((a,b)=>a.x-b.x);
  const d = {
    f, name: raw.name,
    pps: Number(raw.state.pricePerShare)/s,
    tvlUsd: raw.state.totalAssetsUsd,
    tvlNative: Number(raw.state.totalAssets)/s,
    mgmtBps: raw.state.managementFee,
    perfBps: raw.state.performanceFee,
    points, comp: raw.composition,
  };
  cache[key] = { t: Date.now(), d };
  return d;
}

// ---------- formatting ----------
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pct    = x => x==null ? '—' : (x*100).toFixed(2)+'%';
const signed = x => x==null ? '—' : (x>=0?'+':'')+(x*100).toFixed(2)+'%';
const usd    = x => x==null ? '—' : '$'+Math.round(x).toLocaleString('en-US');
const dt     = t => new Date(t*1000).toISOString().slice(0,10);
const fmtPps = (x,dec) => x.toFixed(Math.min(dec,6));

// "Current yield": annualized return of the most recent settlement interval —
// the freshest spot signal from a weekly-settled NAV.
function latestSettlementApr(points){
  if (points.length < 2) return null;
  const a = points[points.length-2], b = points[points.length-1];
  const days = (b.x - a.x) / C.DAY;
  if (days <= 0) return null;
  return Math.pow(b.y / a.y, C.YEAR_DAYS / days) - 1;
}

const hdr = d => `📊 <b>${esc(d.name)}</b> — <i>${esc(d.f.asset)} · ${esc(d.f.chain)}</i>`;

function rNav(d){ const last=d.points[d.points.length-1];
  return `${hdr(d)}\n\n<b>Last NAV / share</b>\n<code>${fmtPps(d.pps,d.f.decimals)} ${esc(d.f.asset)}</code>\n<i>as of ${dt(last.x)} · ${d.points.length} settlements</i>`; }

function rTvl(d){ const extra=d.f.tvlInNative?`\n<i>${d.tvlNative.toLocaleString('en-US',{maximumFractionDigits:1})} ${esc(d.f.asset)}</i>`:'';
  return `${hdr(d)}\n\n<b>Total assets</b>\n${usd(d.tvlUsd)}${extra}`; }

function rYield(d,w){ return `${hdr(d)}\n\n<b>Yield — ${w} days</b>\n${pct(C.trailingYield(d.points,w))}\n<i>trailing, annualized, net of fees</i>`; }

function rCurrent(d){ const last=d.points[d.points.length-1];
  return `${hdr(d)}\n\n<b>Current yield</b>\n${pct(latestSettlementApr(d.points))}\n<i>latest settlement (${dt(last.x)}), annualized, net</i>`; }

function rSince(d){ const first=d.points[0];
  return `${hdr(d)}\n\n<b>Since inception</b>\nTotal return: ${signed(C.cumulativeReturn(d.points))}\nAnnualized (CAGR): ${pct(C.cagr(d.points))}\n<i>since ${dt(first.x)}</i>`; }

function rFees(d){ return `${hdr(d)}\n\n<b>Fees</b>\nManagement: ${(d.mgmtBps/100).toFixed(2)}%\nPerformance: ${(d.perfBps/100).toFixed(2)}%`; }

function rComposition(d){ const c=d.comp;
  if (!c || !c.tokenCompositions || !c.tokenCompositions.length) return `${hdr(d)}\n\n<b>Composition</b> unavailable.`;
  const toks=[...c.tokenCompositions].sort((a,b)=>b.repartition-a.repartition).slice(0,12);
  let out=`${hdr(d)}\n\n<b>Current composition</b> — <i>total ${usd(c.totalValueInUsd)}</i>\n`;
  for (const t of toks) out+=`\n<code>${t.repartition.toFixed(1).padStart(5)}%</code>  ${esc(t.symbol||t.name)}  <i>${usd(t.valueInUsd)}</i>`;
  if (c.compositions && c.compositions.length){
    const pr=[...c.compositions].sort((a,b)=>b.repartition-a.repartition).slice(0,8);
    out+=`\n\n<i>By protocol:</i> `+pr.map(p=>`${esc(p.protocol)} ${p.repartition.toFixed(1)}%`).join(' · ');
  }
  return out;
}

function rAll(d){ const first=d.points[0], last=d.points[d.points.length-1];
  return `${hdr(d)}\n\n`+
    `<b>NAV / share:</b> <code>${fmtPps(d.pps,d.f.decimals)} ${esc(d.f.asset)}</code> <i>(${dt(last.x)})</i>\n`+
    `<b>Current yield:</b> ${pct(latestSettlementApr(d.points))}\n`+
    `<b>Yield 7d:</b> ${pct(C.trailingYield(d.points,7))}\n`+
    `<b>Yield 30d:</b> ${pct(C.trailingYield(d.points,30))}\n`+
    `<b>Since inception:</b> ${signed(C.cumulativeReturn(d.points))} <i>(CAGR ${pct(C.cagr(d.points))}, since ${dt(first.x)})</i>\n`+
    `<b>Total assets:</b> ${usd(d.tvlUsd)}\n`+
    `<b>Fees:</b> ${(d.mgmtBps/100).toFixed(2)}% mgmt · ${(d.perfBps/100).toFixed(2)}% perf`; }

// id -> { label (button text + Telegram command desc), fn }
const METRICS = {
  composition: { label:'🧩 Composition',     fn:rComposition },
  current:     { label:'⚡ Current yield',    fn:rCurrent },
  yield7:      { label:'📅 Yield 7d',         fn:d=>rYield(d,7) },
  yield30:     { label:'🗓 Yield 30d',         fn:d=>rYield(d,30) },
  since:       { label:'📈 Since inception',  fn:rSince },
  nav:         { label:'💲 Last NAV',         fn:rNav },
  tvl:         { label:'🏦 Total assets',     fn:rTvl },
  fees:        { label:'✂️ Fees',             fn:rFees },
  all:         { label:'📋 Everything',       fn:rAll },
};

async function metric(fundKey, id){
  const m = METRICS[id];
  if (!m) throw new Error('Unknown metric: ' + id);
  const d = await fetchFund(fundKey);
  return m.fn(d);
}

module.exports = { FUNDS, METRICS, fetchFund, metric };
