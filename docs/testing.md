# Testing Strategy

## Test Tiers

### Unit Tests (`npm test`)

- **Location:** `src/**/*.test.ts`
- **Runner:** vitest
- **DB:** In-memory SQLite (`:memory:`)
- **What's tested:** Input validation, DB CRUD, state extraction, response parsing
- **Current:** 69 tests across 4 suites

### E2E Tests (`npm run test:e2e`)

- **Location:** `tests/e2e/**/*.test.ts`
- **Runner:** vitest (separate config)
- **DB:** In-memory SQLite
- **SDK:** Mocked — all Pumble API calls are stubbed
- **What's tested:** Full standup lifecycle from DB creation through run execution, DM collection, and summary posting

## E2E Test Architecture

The E2E tests use a mock SDK client that implements the same interface as the real Pumble bot client. This allows testing the full flow without a running Pumble instance.

```
tests/
├── e2e/
│   └── full-flow.test.ts    # Complete lifecycle test
└── helpers/
    └── mock-sdk.ts           # Mock Pumble bot client
```

### Mock SDK

The mock client tracks:
- Messages sent (DMs, channel posts)
- Reactions added
- Channels created (DM channels)
- Messages edited

Tests assert on the mock's recorded calls rather than making real API requests.

### Full Flow Test

The E2E test covers:
1. Create a standup (direct DB insert, no modal mocking)
2. Add questions and participants
3. Trigger a run via `triggerStandupRun()`
4. Verify DM prompts were sent to all participants
5. Simulate `NEW_MESSAGE` events with answers
6. Verify responses are stored
7. Verify summary is posted to the channel
8. Verify reactions were added

### Running E2E Tests

```bash
# Run E2E tests only (excluded from default npm test):
npm run test:e2e

# Run all tests:
npm test && npm run test:e2e
```

## Coverage

```bash
npm run test:coverage
```

Coverage is reported for all `src/` files except test files, `app-types.ts`, and `main.ts`.
