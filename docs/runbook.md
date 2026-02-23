# Operations Runbook

## Deployment

### Docker

```bash
# Build
docker build -t standup-bot .

# Run
docker run -d \
  --name standup-bot \
  -p 5000:5000 \
  -v standup-data:/app/data \
  -e PUMBLE_ADDON_MANIFEST_PATH=/app/manifest.json \
  -e DB_PATH=/app/data/standup.db \
  -e TOKEN_STORE_PATH=/app/data/tokens.json \
  standup-bot
```

### Docker Compose

```bash
docker compose up -d
```

### Verify Deployment

```bash
curl -sf http://localhost:5000/healthz | jq .
# Expected: { "status": "ok", "uptime": N, "version": "1.0.0", "responseTime": N }
```

## Monitoring

### Health Check

```bash
curl http://localhost:5000/healthz
```

- `200 { "status": "ok" }` — healthy
- `503 { "status": "degraded", "error": "..." }` — DB unreachable

### Metrics (Prometheus)

```bash
curl http://localhost:5000/metrics
```

Key metrics:
- `standup_runs_total{status}` — run completions
- `standup_responses_total{type}` — response counts (answered/skipped/late)
- `standup_active_runs` — currently in-progress runs
- `standup_dm_send_duration_seconds` — DM send latency
- `nodejs_eventloop_lag_seconds` — event loop delay
- `process_resident_memory_bytes` — memory usage

### Logs

Structured JSON to stdout. Filter with `jq`:

```bash
# All errors
docker logs standup-bot 2>&1 | jq 'select(.level == "error")'

# Specific run
docker logs standup-bot 2>&1 | jq 'select(.runId == 42)'

# Correlation ID tracing
docker logs standup-bot 2>&1 | jq 'select(.correlationId == "abc123")'

# Summary posts
docker logs standup-bot 2>&1 | jq 'select(.module == "summary")'
```

## Database

### Backup

```bash
npm run db:backup
# Creates: standup.db.bak (safe for WAL mode)
```

For automated backups, add to crontab:

```bash
0 */6 * * * cd /app && npm run db:backup && cp standup.db.bak /backups/standup-$(date +%Y%m%d-%H%M).db
```

### Restore

```bash
# Stop the bot first
docker stop standup-bot

# Replace the DB file
cp /backups/standup-YYYYMMDD-HHMM.db /app/data/standup.db

# Restart
docker start standup-bot
```

### Integrity Check

The bot runs `PRAGMA integrity_check` on startup and refuses to start if corruption is detected. To manually check:

```bash
sqlite3 standup.db "PRAGMA integrity_check"
# Expected: ok
```

### Data Retention

Completed runs older than `RETENTION_DAYS` (default 90) are automatically deleted daily at 03:00 UTC. Adjust via the `RETENTION_DAYS` environment variable.

## Token Rotation

1. Go to the Pumble marketplace developer portal
2. Rotate the client secret / signing secret
3. Update environment variables:
   - `PUMBLE_APP_CLIENT_SECRET`
   - `PUMBLE_APP_SIGNING_SECRET`
4. Restart the bot

The `tokens.json` file contains OAuth tokens and will be refreshed automatically by the SDK.

## Troubleshooting

### Bot not responding to commands

1. Check health: `curl http://localhost:5000/healthz`
2. Check logs for errors: `docker logs standup-bot 2>&1 | jq 'select(.level == "error")' | tail -20`
3. Verify the manifest URL is reachable from Pumble servers
4. Verify `PUMBLE_APP_SIGNING_SECRET` matches the marketplace config

### DMs not being delivered

1. Check bot scopes include `messages:write` and `channels:read`
2. Check logs for retry failures: `jq 'select(.op == "sendPrompt")' < logs`
3. Verify the bot is installed in the target workspace

### Cron not firing

1. Check the cron expression is valid: `npx node-cron validate "0 9 * * 1,2,3,4,5"`
2. Check the standup is active: `sqlite3 standup.db "SELECT name, active, cron_expr FROM standups"`
3. Check logs: `jq 'select(.module == "scheduler")' < logs`

### Database locked

SQLite WAL mode supports concurrent reads but only one writer. If "database locked" errors appear:
1. Check for zombie processes holding the DB
2. Ensure only one instance of the bot is running
3. Check disk space (WAL files can grow if checkpoints fail)

### Summary not posting

1. Check the bot has `messages:write` scope for the target channel
2. Check logs: `jq 'select(.module == "summary" and .level == "error")' < logs`
3. The run may have been marked COMPLETE with an empty `summary_msg_id` after retry failure — check the `runs` table
