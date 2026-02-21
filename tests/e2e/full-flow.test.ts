import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandupDB } from '../../src/db/index';
import { createMockBotClient } from '../helpers/mock-sdk';
import type { NewStandup } from '../../src/types';
import type { ApiClient } from '../../src/app-types';

// We need to stub getDB and getAddonInstance before importing engine modules
import { vi } from 'vitest';

let db: StandupDB;
const mock = createMockBotClient();

// Mock the DB module to return our in-memory DB
vi.mock('../../src/db/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/index')>();
  return {
    ...actual,
    getDB: () => db,
    closeDB: () => db?.close(),
  };
});

// Mock the addon-instance to return our mock client
vi.mock('../../src/addon-instance', () => ({
  getAddonInstance: () => ({
    getBotClient: async () => mock.client,
  }),
  setAddonInstance: () => {},
}));

// Now import engine modules (they'll use our mocked getDB)
import { triggerStandupRun } from '../../src/engine/runner';

const testStandup: NewStandup = {
  workspace_id: 'ws_e2e',
  name: 'E2E Standup',
  channel_id: 'ch_e2e',
  channel_name: 'general',
  cron_expr: '0 9 * * 1,2,3,4,5',
  timezone: 'UTC',
  reminder_mins: 30,
  cutoff_mins: 120,
  created_by: 'admin_user',
};

describe('E2E: Full standup flow', () => {
  beforeEach(() => {
    db = new StandupDB(':memory:');
    mock.reset();

    // Seed workspace
    db.upsertWorkspace({
      id: 'ws_e2e',
      bot_token: 'mock-token',
      bot_user_id: 'bot_e2e',
      app_key: 'mock-key',
      installed_at: new Date().toISOString(),
      active: 1,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('creates standup, triggers run, sends DMs, collects responses, posts summary', async () => {
    // 1. Create a standup
    const standupId = db.createStandup(testStandup);
    expect(standupId).toBeGreaterThan(0);

    // 2. Add questions
    db.replaceQuestions(standupId, [
      { text: 'What did you do yesterday?', sort_order: 0, is_blocker: 0 },
      { text: 'What will you do today?', sort_order: 1, is_blocker: 0 },
      { text: 'Any blockers?', sort_order: 2, is_blocker: 1 },
    ]);

    // 3. Add participants
    db.addParticipant(standupId, 'user_a');
    db.addParticipant(standupId, 'user_b');

    // 4. Trigger a run
    const standup = db.getStandupById(standupId)!;
    await triggerStandupRun(standup, mock.client as unknown as ApiClient, 'manual');

    // 5. Verify DMs were sent to both participants
    // Each user gets: getDirectChannel + postMessageToChannel = one sent message per user
    const dmMessages = mock.sentMessages.filter(
      (m) => m.channelId.startsWith('dm_user_')
    );
    expect(dmMessages.length).toBe(2);

    // 6. Verify a run was created in DB
    const run = db.getLatestRun(standupId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('COLLECTING');

    // 7. Store responses (simulating what collector does)
    db.storeResponse(run!.id, 'user_a', ['Did X', 'Will do Y', 'none'], false, false, 1);
    db.storeResponse(run!.id, 'user_b', ['Did A', 'Will do B', 'Database issue'], false, false, 1);

    // 8. Verify responses are stored
    const responses = db.getResponses(run!.id);
    expect(responses.length).toBe(2);

    // 9. Verify blockers are detected
    const blockers = db.getBlockers(run!.id);
    expect(blockers.length).toBe(1);
    expect(blockers[0]!.user_id).toBe('user_b');
    expect(blockers[0]!.blocker_text).toBe('Database issue');

    // 10. Check summary posting via checkAndPostSummary
    const { checkAndPostSummary } = await import('../../src/engine/summary');
    await checkAndPostSummary(run!.id, standupId);

    // Verify summary was posted to the standup channel
    const summaryMessages = mock.sentMessages.filter(
      (m) => m.channelId === 'ch_e2e'
    );
    expect(summaryMessages.length).toBe(1);
    expect(summaryMessages[0]!.text).toContain('E2E Standup');

    // 11. Verify run is marked COMPLETE
    const completedRun = db.getRun(run!.id);
    expect(completedRun!.status).toBe('COMPLETE');
  });

  it('handles skip responses correctly', async () => {
    const standupId = db.createStandup(testStandup);
    db.replaceQuestions(standupId, [
      { text: 'What did you do?', sort_order: 0, is_blocker: 0 },
    ]);
    db.addParticipant(standupId, 'user_a');

    const standup = db.getStandupById(standupId)!;
    await triggerStandupRun(standup, mock.client as unknown as ApiClient, 'manual');

    const run = db.getLatestRun(standupId)!;

    // Simulate skip
    db.storeResponse(run.id, 'user_a', [], true, false, 0);

    const responses = db.getResponses(run.id);
    expect(responses.length).toBe(1);
    expect(responses[0]!.is_skipped).toBe(1);
  });

  it('idempotent run trigger skips duplicate', async () => {
    const standupId = db.createStandup(testStandup);
    db.replaceQuestions(standupId, [
      { text: 'Question?', sort_order: 0, is_blocker: 0 },
    ]);
    db.addParticipant(standupId, 'user_a');

    const standup = db.getStandupById(standupId)!;
    await triggerStandupRun(standup, mock.client as unknown as ApiClient, 'manual');
    await triggerStandupRun(standup, mock.client as unknown as ApiClient, 'manual');

    // Only one DM should have been sent (to user_a, once)
    const dmMessages = mock.sentMessages.filter(
      (m) => m.channelId.startsWith('dm_user_')
    );
    expect(dmMessages.length).toBe(1);
  });
});
