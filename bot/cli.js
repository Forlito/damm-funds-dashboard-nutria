// cli.js — dry-run: print every metric for both funds to the terminal, with no
// Telegram token. Lets you verify the data/formatting before going live.
//   node cli.js            (all funds, all metrics)
//   node cli.js stable nav (one fund, one metric)
'use strict';
const { FUNDS, METRICS, metric } = require('./data.js');
const stripHtml = s => s.replace(/<[^>]+>/g, '');

(async () => {
  const [argFund, argMetric] = process.argv.slice(2);
  const funds = argFund ? [argFund] : Object.keys(FUNDS);
  const metrics = argMetric ? [argMetric] : Object.keys(METRICS);
  for (const key of funds) {
    console.log('\n══════════ ' + (FUNDS[key]?FUNDS[key].label:key) + ' ══════════');
    for (const id of metrics) {
      try {
        const text = await metric(key, id);
        console.log('\n── /' + id + ' ──\n' + stripHtml(text));
      } catch (e) {
        console.log('\n── /' + id + ' ──\n⚠️ ' + e.message);
      }
    }
  }
  console.log('');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
