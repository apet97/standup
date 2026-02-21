# Standup Bot

Async standup bot for [Pumble](https://pumble.com). Schedules recurring check-ins, collects answers via DM, and posts summaries to a team channel.

## What it does

- `/standup create` — modal wizard to set up a standup (name, questions, schedule, participants)
- `/standup run <name>` — trigger a run manually
- `/standup list` — list standups in the workspace
- `/standup status <name>` — show run status and streaks
- `/standup pause/resume <name>` — toggle schedule
- `/standup questions <name>` — edit questions
- `/standup participants <name>` — add/remove participants
- `/standup help` — command list

When a standup runs, the bot DMs each participant with numbered questions. Participants reply in the DM. After the cutoff the bot posts a summary to the configured channel. Late responses edit the summary. Reply "skip" to skip or "snooze 30" to delay your prompt.

## Setup

```bash
cp .env.example .env
npm install
npx pumble-cli login
npx pumble-cli create
```

Update URLs in `manifest.json` to your public HTTPS endpoint, then:

```bash
npm run dev          # development
npm run build && npm start  # production
```

### Docker

```bash
docker compose up --build
```

## Tech

- TypeScript (strict), pumble-sdk, better-sqlite3, node-cron, pino
- SQLite with WAL mode and migration-based schema
- 69 tests via vitest

## Project structure

```
src/
├── main.ts              # app startup, shutdown, handler wiring
├── types.ts             # domain types
├── config.ts            # env validation
├── db/                  # SQLite schema, migrations, queries
├── commands/            # slash command handlers + modals
├── engine/              # run engine, DM collection, summaries
└── scheduler/           # cron job management
```

## License

MIT
