# Changelog

All notable changes to the Standup Bot will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-02-24

### Added

- Prometheus metrics endpoint (`GET /metrics`) with run/response counters, DM send histogram, event loop lag
- E2E test suite with mock SDK (`npm run test:e2e`)
- Pluggable error reporter with optional Sentry integration (`SENTRY_DSN`)
- Operations runbook (`docs/runbook.md`) and config reference (`docs/config.md`)
- Dependabot configuration for automated dependency updates

### Changed

- Healthcheck reads version from `package.json` at startup (works outside `npm start`)
- `cleanupOldRuns()` processes in chunks of 500 to avoid blocking event loop
- Fixed 6 high-severity vulnerabilities in `@typescript-eslint` packages

## [1.0.0] - 2026-02-23

### Added

- Async standup bot for Pumble with full lifecycle management
- `/standup` slash command with 9 subcommands (create, list, status, run, pause, resume, questions, participants, help)
- 3-step modal wizard for standup creation
- DM-based prompt/response collection with skip, snooze, and late response support
- Rich text summary posting with blocker highlighting and streak tracking
- Scheduled standup runs via cron expressions with timezone support
- SQLite database with migration framework (WAL mode, foreign keys)
- Structured JSON logging via pino with correlation IDs
- Input validation for all user inputs (names, cron, time, questions, snooze)
- Rate limiting on slash commands (10/min per user per workspace)
- Exponential backoff retry for all Pumble API calls
- Graceful shutdown with run interruption and timer cleanup
- Crash recovery for in-progress runs
- Data retention cleanup (configurable, default 90 days)
- Health check endpoint (`GET /healthz`)
- Metrics endpoint (`GET /metrics`) with Prometheus format
- Docker multi-stage build with health check
- CI pipeline (GitHub Actions, Node 20.x/22.x matrix)
- ESLint + Prettier configuration
- 69 tests across 4 suites (vitest)
- SQLite backup script (`npm run db:backup`)

### Versioning Workflow

To release a new version:

```bash
# Patch release (bug fixes):
npm version patch

# Minor release (new features):
npm version minor

# Major release (breaking changes):
npm version major

# Then push with tags:
git push && git push --tags
```
