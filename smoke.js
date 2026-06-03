// smoke.js — end-to-end data check against the live Lagoon API (no DOM).
// Replicates index.html's processing pipeline. Run: node smoke.js
'use strict';
const { syntheticDaily, aprBars, rollingMean } = require('./core.js');

const VAULTS = [
  { key: 'dammstable', label: 'DAMMstable', address: '0xE5d6eb448Ac5A762C1ebE8cd1692b9CD08025176', chainId: 42161, decimals: 6, asset: 'USDT0' },
  { key: 'dammeth', label: 'DAMMeth', address: '0x3c63f3cE75dc83735745CF4e86B63414D95Ee355', chainId: 1, decimals: 18, asset: 'WETH' },
];

async function main() {
  const parts = VAULTS.map(v => `
    ${v.key}: vaultByAddress(address: "${v.address.toLowerCase()}", chainId: ${v.chainId}) {
      name symbol state { pricePerShare totalAssetsUsd }
      stateHistory { pricePerShare(options: {}) { x y } }
    }`);
  const res = await fetch('https://api.lagoon.finance/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ ${parts.join('\n')} }` }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  for (const v of VAULTS) {
    const raw = json.data[v.key];
    const scale = 10 ** v.decimals;
    const points = raw.stateHistory.pricePerShare.map(p => ({ x: p.x, y: Number(p.y) / scale })).sort((a, b) => a.x - b.x);
    const daily = syntheticDaily(points);
    console.log(`\n${raw.name} (${raw.symbol}) — ${points.length} settlements, ${daily.length} synthetic days`);
    console.log(`  pps now: ${(Number(raw.state.pricePerShare) / scale).toFixed(6)} ${v.asset}, TVL $${Math.round(raw.state.totalAssetsUsd).toLocaleString()}`);
    console.log(`  range: ${new Date(points[0].x * 1e3).toISOString().slice(0, 10)} -> ${new Date(points.at(-1).x * 1e3).toISOString().slice(0, 10)}`);
    for (const [g, m] of [['daily', 'calendar'], ['weekly', 'calendar'], ['weekly', 'fixed'], ['monthly', 'calendar'], ['monthly', 'fixed']]) {
      const bars = aprBars(daily, g, m);
      const aprs = bars.map(b => b.apr);
      const roll = rollingMean(aprs, { daily: 7, weekly: 4, monthly: 3 }[g]);
      const bad = aprs.filter(a => !isFinite(a)).length + roll.filter(r => r !== null && !isFinite(r)).length;
      const mean = aprs.reduce((a, b) => a + b, 0) / aprs.length;
      console.log(`  ${g.padEnd(7)}/${m.padEnd(8)}: ${String(bars.length).padStart(3)} bars, mean APR ${(mean * 100).toFixed(2)}%, min ${(Math.min(...aprs) * 100).toFixed(2)}%, max ${(Math.max(...aprs) * 100).toFixed(2)}%${bad ? `  <-- ${bad} NON-FINITE VALUES` : ''}`);
    }
  }
  console.log('\nSmoke test OK.');
}

main().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
