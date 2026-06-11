# DAMM Funds — Telegram bot

A small **local** Telegram bot that reports live performance for the two DAMM
funds — **DAMMstable** and **DAMM-IF** (DAMMeth) — straight from the Lagoon API.
It shares `../core.js` with the dashboard, so the numbers are identical.

## Commands

Tap buttons (after `/start`) or use slash commands. Each command works for either
fund — either tap the fund button, or pass it as an argument (`stable` | `if`):

| Command | Returns |
|---|---|
| `/start` | Menu: pick a fund, then a metric (button-driven) |
| `/composition` | Current composition (by token + by protocol) |
| `/current` | Current yield (latest settlement, annualized) |
| `/yield7` | Yield — trailing 7 days (annualized) |
| `/yield30` | Yield — trailing 30 days (annualized) |
| `/since` | Since inception — total return + CAGR |
| `/nav` | Last NAV per share + settlement date |
| `/tvl` | Total assets |
| `/fees` | Management & performance fees |
| `/all` | Everything in one message |

Examples: `/nav stable`, `/yield30 if`. With no argument the bot shows fund buttons.

All yields are **net of fees** and annualized. Because NAV settles ~weekly, the
7d/30d figures are computed from the settled price-per-share series (same method
as the dashboard).

## Try it with no token first (dry run)

Prints every command's output to the terminal — no Telegram needed:

```bash
cd bot
npm install
npm run dry            # all funds, all metrics
node cli.js stable nav # one fund, one metric
```

## Run the live bot

1. **Create a bot token** — in Telegram, message **@BotFather** → `/newbot`, pick a
   name and username; it gives you a token like `123456:ABC-...`.
2. **Install & run:**

   ```bash
   cd bot
   npm install
   TELEGRAM_BOT_TOKEN="123456:ABC-your-token" npm start
   ```

3. In Telegram, open your new bot and send `/start`.

The bot uses long-polling, so it just needs to be running on your machine — no
public URL, no webhook, no port to open.

## Restrict who can use it (recommended)

By default anyone who finds the bot can query it. To lock it to your own
chat(s), set `ALLOWED_CHAT_IDS` (comma-separated). To find your chat ID, run the
bot once, send it `/start`, and it will work; or message
[@userinfobot](https://t.me/userinfobot) which replies with your ID.

```bash
TELEGRAM_BOT_TOKEN="..." ALLOWED_CHAT_IDS="123456789" npm start
```

## Keep it running (optional)

For a long-lived local process, use a tiny supervisor, e.g.:

```bash
npx pm2 start bot.js --name damm-funds-bot \
  --update-env -- # env vars must be exported first, or use an .env loader
```

or just run it inside `screen`/`tmux`.

## Files

| File | Purpose |
|---|---|
| `data.js` | Fetch from Lagoon + format each metric (reuses `../core.js`) |
| `bot.js` | Telegram wiring (commands, inline-button menu, access control) |
| `cli.js` | Dry-run — print metrics without a token |

## Notes

- **Composition** comes from Lagoon's `composition` field. For DAMMstable the
  composition total can differ from total assets (Lagoon reports deployed
  positions; idle/pending capital may not appear) — this mirrors what Lagoon's
  own UI shows.
- Data is cached 60s per fund to avoid hammering the API on rapid taps.
- No secrets are stored in the repo; the token is read from the environment.
