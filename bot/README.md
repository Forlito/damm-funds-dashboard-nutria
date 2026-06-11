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
| `/yield7` | Yield — trailing 7 days (annualized, net) |
| `/yield30` | Yield — trailing 30 days (annualized, net) |
| `/composition` | Current composition — the actual holdings (positions, %, $, APY) |
| `/decomposition` | Breakdown by underlying asset and by protocol exposure |
| `/price` | Last share price (NAV per share) + settlement date |
| `/drawdown` | Maximum drawdown |
| `/negmonths` | % of negative months |

Examples: `/price stable`, `/yield30 if`. With no argument the bot shows fund buttons.

**Data sources.** Yields, share price, max drawdown and % negative months are
computed from the **Lagoon** price-per-share history (same engine as the
dashboard; net of fees, annualized — NAV settles ~weekly). **Composition and
decomposition come from the DAMM allocator** (`dammallocator.vercel.app`), which
is the correct, complete source — the Lagoon `composition` field only reports
deployed positions and is incomplete.

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

## Composition source (allocator)

Composition/decomposition are fetched from the allocator bundle. Defaults work
out of the box; override via env vars if needed:

```bash
ALLOCATOR_URL="https://dammallocator.vercel.app/data/funds-bundle.json"
ALLOCATOR_USER="damm"
ALLOCATOR_PASS="nutria"
```

If the allocator is unreachable, composition/decomposition reply "unavailable"
while the Lagoon-based metrics (yields, price, drawdown, neg-months) keep working.

## Notes

- Lagoon data is cached 60s per fund; the allocator bundle 5 min.
- No secrets are stored in the repo; the bot token (and allocator creds, if you
  override the defaults) are read from the environment.
