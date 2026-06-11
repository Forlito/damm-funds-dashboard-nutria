// bot.js — DAMM Funds Telegram bot (local, long-polling).
//
// Run:  TELEGRAM_BOT_TOKEN=xxxxx node bot.js
// Optional access control: ALLOWED_CHAT_IDS="111,222" (comma-separated chat IDs).
'use strict';
const TelegramBot = require('node-telegram-bot-api');
const { FUNDS, METRICS, metric } = require('./data.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Get one from @BotFather, then:\n  TELEGRAM_BOT_TOKEN=xxxx node bot.js');
  process.exit(1);
}
const ALLOWED = (process.env.ALLOWED_CHAT_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
const allowed = chatId => !ALLOWED.length || ALLOWED.includes(String(chatId));

const bot = new TelegramBot(TOKEN, { polling:true });
const HTML = { parse_mode:'HTML', disable_web_page_preview:true };

// ---------- keyboards ----------
const fundKeyboard = {
  inline_keyboard: Object.values(FUNDS).map(f => [{ text: f.label + (f.note?' '+f.note:''), callback_data:'f:'+f.key }]),
};
function metricKeyboard(fundKey){
  const b = id => ({ text: METRICS[id].label, callback_data:`m:${fundKey}:${id}` });
  return { inline_keyboard: [
    [b('yield7'), b('yield30')],
    [b('composition'), b('decomposition')],
    [b('price')],
    [b('drawdown'), b('negmonths')],
    [{ text:'↩ Switch fund', callback_data:'menu' }],
  ] };
}
// For a slash command issued without a fund: choose fund, then run that metric.
const fundChooserFor = id => ({
  inline_keyboard: Object.values(FUNDS).map(f => [{ text:f.label+(f.note?' '+f.note:''), callback_data:`m:${f.key}:${id}` }]),
});

const FUND_MENU = '<b>DAMM Funds</b>\nChoose a fund:';
const metricMenuText = key => `<b>${FUNDS[key].label}</b> — choose a metric:`;

// ---------- command registration ----------
bot.setMyCommands([
  { command:'start',         description:'Open the menu' },
  { command:'yield7',        description:'Yield — 7 days' },
  { command:'yield30',       description:'Yield — 30 days' },
  { command:'composition',   description:'Current composition (holdings)' },
  { command:'decomposition', description:'Decomposition (by asset & protocol)' },
  { command:'price',         description:'Last share price (NAV)' },
  { command:'drawdown',      description:'Maximum drawdown' },
  { command:'negmonths',     description:'% of negative months' },
]).catch(()=>{});

// ---------- menu commands ----------
bot.onText(/^\/(start|menu|help)\b/, msg => {
  if (!allowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, 'Not authorized.');
  bot.sendMessage(msg.chat.id, FUND_MENU, { ...HTML, reply_markup: fundKeyboard });
});

// ---------- direct metric slash commands ----------
// Accept an optional fund arg, e.g. "/yield7 stable" or "/nav if". With no arg,
// show the fund chooser wired to that metric.
const CMD_RE = /^\/(yield7|yield30|composition|decomposition|price|drawdown|negmonths)(?:@\w+)?(?:\s+(stable|if|damm-?if|eth))?\b/i;
bot.onText(CMD_RE, async (msg, m) => {
  if (!allowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, 'Not authorized.');
  const id = m[1].toLowerCase();
  let fund = (m[2]||'').toLowerCase();
  if (fund==='eth' || fund==='dammif' || fund==='damm-if') fund='if';
  if (!fund) {
    return bot.sendMessage(msg.chat.id, `<b>${METRICS[id].label}</b> — choose a fund:`, { ...HTML, reply_markup: fundChooserFor(id) });
  }
  try {
    const text = await metric(fund, id);
    bot.sendMessage(msg.chat.id, text, { ...HTML, reply_markup: metricKeyboard(fund) });
  } catch (e) {
    bot.sendMessage(msg.chat.id, '⚠️ ' + e.message);
  }
});

// ---------- inline button handler ----------
bot.on('callback_query', async cq => {
  const chatId = cq.message.chat.id, msgId = cq.message.message_id, data = cq.data;
  if (!allowed(chatId)) { bot.answerCallbackQuery(cq.id, { text:'Not authorized.' }); return; }
  try {
    if (data === 'menu') {
      bot.answerCallbackQuery(cq.id);
      return bot.editMessageText(FUND_MENU, { chat_id:chatId, message_id:msgId, ...HTML, reply_markup: fundKeyboard });
    }
    if (data.startsWith('f:')) {
      const key = data.slice(2);
      bot.answerCallbackQuery(cq.id);
      return bot.editMessageText(metricMenuText(key), { chat_id:chatId, message_id:msgId, ...HTML, reply_markup: metricKeyboard(key) });
    }
    if (data.startsWith('m:')) {
      const [, key, id] = data.split(':');
      bot.answerCallbackQuery(cq.id, { text:'Fetching…' });
      const text = await metric(key, id);
      return bot.editMessageText(text, { chat_id:chatId, message_id:msgId, ...HTML, reply_markup: metricKeyboard(key) });
    }
    bot.answerCallbackQuery(cq.id);
  } catch (e) {
    bot.answerCallbackQuery(cq.id, { text:'Error' });
    bot.sendMessage(chatId, '⚠️ ' + e.message);
  }
});

bot.on('polling_error', e => console.error('polling_error:', e.code || e.message));
console.log('DAMM Funds bot is running (long-polling). Press Ctrl+C to stop.');
if (ALLOWED.length) console.log('Access restricted to chat IDs:', ALLOWED.join(', '));
