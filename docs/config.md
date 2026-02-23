# Configuration Reference

All configuration is via environment variables. Use a `.env` file for local development.

## Required

| Variable | Type | Default | Description |
|---|---|---|---|
| `PUMBLE_ADDON_MANIFEST_PATH` | string | — | Path to `manifest.json` |

## Optional

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | integer (1-65535) | `5000` | HTTP server port |
| `DB_PATH` | string | `./standup.db` | SQLite database file path |
| `TOKEN_STORE_PATH` | string | `./tokens.json` | Path for Pumble SDK token storage |
| `LOG_LEVEL` | string | `info` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |
| `RETENTION_DAYS` | integer | `90` | Days to keep completed runs before cleanup |
| `SENTRY_DSN` | string | — | Sentry DSN for error reporting (optional) |

## Pumble SDK Variables (set by Pumble platform)

| Variable | Type | Description |
|---|---|---|
| `PUMBLE_APP_ID` | string | Application ID from Pumble marketplace |
| `PUMBLE_APP_KEY` | string | Application key |
| `PUMBLE_APP_CLIENT_SECRET` | string | OAuth2 client secret |
| `PUMBLE_APP_SIGNING_SECRET` | string | Request signature verification secret |

## Notes

- `SIGNING_SECRET` in `config.ts` maps to `PUMBLE_APP_SIGNING_SECRET`. The SDK reads this automatically for request verification.
- `TOKEN_STORE_PATH` should be excluded from Docker images and version control.
- `DB_PATH` must point to a writable directory. The SQLite WAL files (`-wal`, `-shm`) will be created alongside it.
- `LOG_LEVEL=debug` is recommended for development; `info` for production.
