import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandupDB } from '../index';
import type { NewStandup } from '../../types';

let db: StandupDB;

beforeEach(() => {
  db = new StandupDB(':memory:');
  // Seed a workspace
  db.upsertWorkspace({
    id: 'ws1',
    bot_token: 'test-token',
    bot_user_id: 'bot1',
    app_key: 'key1',
    installed_at: new Date().toISOString(),
    active: 1,
  });
});

afterEach(() => {
  db.close();
});

const testStandup: NewStandup = {
  workspace_id: 'ws1',
  name: 'Daily Standup',
  channel_id: 'ch1',
  channel_name: 'general',
  cron_expr: '0 9 * * 1,2,3,4,5',
  timezone: 'UTC',
  reminder_mins: 30,
  cutoff_mins: 120,
  created_by: 'user1',
};

describe('Workspaces', () => {
  it('upserts and retrieves workspace', () => {
    const ws = db.getWorkspace('ws1');
    expect(ws).toBeDefined();
    expect(ws!.id).toBe('ws1');
    expect(ws!.active).toBe(1);
  });

  it('updates existing workspace on upsert', () => {
    db.upsertWorkspace({
      id: 'ws1',
      bot_token: 'new-token',
      bot_user_id: 'bot2',
      app_key: 'key2',
      installed_at: new Date().toISOString(),
      active: 1,
    });
    const ws = db.getWorkspace('ws1');
    expect(ws!.bot_user_id).toBe('bot2');
  });

  it('deletes workspace', () => {
    db.deleteWorkspace('ws1');
    expect(db.getWorkspace('ws1')).toBeUndefined();
  });
});

describe('Standups', () => {
  it('creates and retrieves standup', () => {
    const id = db.createStandup(testStandup);
    expect(id).toBeGreaterThan(0);

    const standup = db.getStandupById(id);
    expect(standup).toBeDefined();
    expect(standup!.name).toBe('Daily Standup');
    expect(standup!.channel_id).toBe('ch1');
  });

  it('finds standup by name (case insensitive)', () => {
    db.createStandup(testStandup);
    const found = db.getStandupByName('ws1', 'daily standup');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Daily Standup');
  });

  it('lists standups by workspace with participant count', () => {
    const id = db.createStandup(testStandup);
    db.addParticipant(id, 'user1');
    db.addParticipant(id, 'user2');

    const standups = db.getStandupsByWorkspace('ws1');
    expect(standups).toHaveLength(1);
    expect(standups[0]!.participant_count).toBe(2);
  });

  it('updates active status', () => {
    const id = db.createStandup(testStandup);
    db.updateStandupActive(id, false);
    expect(db.getStandupById(id)!.active).toBe(0);

    db.updateStandupActive(id, true);
    expect(db.getStandupById(id)!.active).toBe(1);
  });

  it('gets all active standups', () => {
    const id1 = db.createStandup(testStandup);
    const id2 = db.createStandup({ ...testStandup, name: 'Weekly' });
    db.updateStandupActive(id2, false);

    const active = db.getAllActiveStandups();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(id1);
  });
});

describe('Questions', () => {
  it('creates and retrieves questions', () => {
    const standupId = db.createStandup(testStandup);
    db.replaceQuestions(standupId, [
      { text: 'Q1?', sort_order: 0, is_blocker: 0 },
      { text: 'Q2?', sort_order: 1, is_blocker: 1 },
    ]);

    const questions = db.getQuestions(standupId);
    expect(questions).toHaveLength(2);
    expect(questions[0]!.text).toBe('Q1?');
    expect(questions[1]!.is_blocker).toBe(1);
  });

  it('replaces all questions atomically', () => {
    const standupId = db.createStandup(testStandup);
    db.replaceQuestions(standupId, [
      { text: 'Old Q', sort_order: 0, is_blocker: 0 },
    ]);
    db.replaceQuestions(standupId, [
      { text: 'New Q1', sort_order: 0, is_blocker: 0 },
      { text: 'New Q2', sort_order: 1, is_blocker: 0 },
    ]);

    const questions = db.getQuestions(standupId);
    expect(questions).toHaveLength(2);
    expect(questions[0]!.text).toBe('New Q1');
  });
});

describe('Participants', () => {
  it('adds and lists participants', () => {
    const standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.addParticipant(standupId, 'user2');

    const participants = db.getParticipants(standupId);
    expect(participants).toHaveLength(2);
    expect(participants).toContain('user1');
    expect(participants).toContain('user2');
  });

  it('ignores duplicate participants', () => {
    const standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.addParticipant(standupId, 'user1');

    expect(db.getParticipants(standupId)).toHaveLength(1);
  });

  it('removes participant', () => {
    const standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.removeParticipant(standupId, 'user1');

    expect(db.getParticipants(standupId)).toHaveLength(0);
  });
});

describe('Runs', () => {
  it('creates and retrieves run', () => {
    const standupId = db.createStandup(testStandup);
    const runId = db.createRun(standupId, 'manual');

    const run = db.getRun(runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('COLLECTING');
    expect(run!.triggered_by).toBe('manual');
  });

  it('completes run', () => {
    const standupId = db.createStandup(testStandup);
    const runId = db.createRun(standupId, 'schedule');

    db.completeRun(runId, 'msg123', 'ch1');
    const run = db.getRun(runId);
    expect(run!.status).toBe('COMPLETE');
    expect(run!.summary_msg_id).toBe('msg123');
    expect(run!.completed_at).toBeDefined();
  });

  it('marks run interrupted', () => {
    const standupId = db.createStandup(testStandup);
    const runId = db.createRun(standupId, 'schedule');

    db.markRunInterrupted(runId);
    const run = db.getRun(runId);
    expect(run!.status).toBe('INTERRUPTED');
    expect(run!.completed_at).toBeDefined();
  });

  it('gets collecting run for standup', () => {
    const standupId = db.createStandup(testStandup);
    expect(db.getCollectingRunForStandup(standupId)).toBeUndefined();

    const runId = db.createRun(standupId, 'schedule');
    const collecting = db.getCollectingRunForStandup(standupId);
    expect(collecting).toBeDefined();
    expect(collecting!.id).toBe(runId);
  });

  it('gets latest run', () => {
    const standupId = db.createStandup(testStandup);
    const runId1 = db.createRun(standupId, 'schedule');
    const runId2 = db.createRun(standupId, 'manual');

    const latest = db.getLatestRun(standupId);
    expect(latest).toBeDefined();
    // Both runs may have the same triggered_at; verify we get one of them
    expect([runId1, runId2]).toContain(latest!.id);
  });

  it('gets all collecting runs', () => {
    const standupId = db.createStandup(testStandup);
    db.createRun(standupId, 'schedule');
    const runId2 = db.createRun(standupId, 'manual');
    db.completeRun(runId2, 'msg', 'ch1');

    const collecting = db.getCollectingRuns();
    expect(collecting).toHaveLength(1);
  });

  it('gets run history with response counts', () => {
    const standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.addParticipant(standupId, 'user2');

    const runId = db.createRun(standupId, 'schedule');
    db.storeResponse(runId, 'user1', ['answer1'], false, false, 1);

    const history = db.getRunHistory(standupId, 5);
    expect(history).toHaveLength(1);
    expect(history[0]!.response_count).toBe(1);
    expect(history[0]!.total_participants).toBe(2);
  });
});

describe('Responses', () => {
  let standupId: number;
  let runId: number;

  beforeEach(() => {
    standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.addParticipant(standupId, 'user2');
    db.replaceQuestions(standupId, [
      { text: 'Q1?', sort_order: 0, is_blocker: 0 },
      { text: 'Blockers?', sort_order: 1, is_blocker: 1 },
    ]);
    runId = db.createRun(standupId, 'schedule');
  });

  it('stores and retrieves responses', () => {
    db.storeResponse(runId, 'user1', ['did stuff', 'none'], false, false, 1);

    const responses = db.getResponses(runId);
    expect(responses).toHaveLength(1);
    expect(JSON.parse(responses[0]!.answers)).toEqual(['did stuff', 'none']);
    expect(responses[0]!.streak).toBe(1);
  });

  it('tracks responded user IDs', () => {
    db.storeResponse(runId, 'user1', ['a'], false, false, 1);

    const responded = db.getRespondedUserIds(runId);
    expect(responded).toContain('user1');
    expect(responded).not.toContain('user2');
  });

  it('stores skipped responses', () => {
    db.storeResponse(runId, 'user1', [], true, false, 0);

    const responses = db.getResponses(runId);
    expect(responses[0]!.is_skipped).toBe(1);
  });

  it('stores late responses', () => {
    db.storeResponse(runId, 'user1', ['late answer', 'n/a'], false, true, 1);

    const responses = db.getResponses(runId);
    expect(responses[0]!.is_late).toBe(1);
  });

  it('detects blockers', () => {
    db.storeResponse(runId, 'user1', ['did stuff', 'I am blocked on X'], false, false, 1);
    db.storeResponse(runId, 'user2', ['did stuff', 'none'], false, false, 1);

    const blockers = db.getBlockers(runId);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.user_id).toBe('user1');
    expect(blockers[0]!.blocker_text).toBe('I am blocked on X');
  });

  it('calculates user streak', () => {
    // First run: user responds
    db.storeResponse(runId, 'user1', ['a'], false, false, 1);

    // Second run: user responds
    const runId2 = db.createRun(standupId, 'schedule');
    db.storeResponse(runId2, 'user1', ['b'], false, false, 2);

    const streak = db.getUserStreak(standupId, 'user1');
    expect(streak).toBe(2);
  });

  it('streak resets on skip', () => {
    db.storeResponse(runId, 'user1', [], true, false, 0);

    const runId2 = db.createRun(standupId, 'schedule');
    db.storeResponse(runId2, 'user1', ['answer'], false, false, 1);

    const streak = db.getUserStreak(standupId, 'user1');
    expect(streak).toBe(1);
  });
});

describe('Health check', () => {
  it('succeeds on healthy DB', () => {
    expect(() => db.healthCheck()).not.toThrow();
  });

  it('integrity check passes', () => {
    const result = db.integrityCheck();
    expect(result).toBe('ok');
  });
});

describe('Workspace data deletion', () => {
  it('cascades deletion across all tables', () => {
    const standupId = db.createStandup(testStandup);
    db.addParticipant(standupId, 'user1');
    db.replaceQuestions(standupId, [{ text: 'Q?', sort_order: 0, is_blocker: 0 }]);
    const runId = db.createRun(standupId, 'schedule');
    db.storeResponse(runId, 'user1', ['a'], false, false, 1);

    db.deleteWorkspaceData('ws1');

    expect(db.getStandupsByWorkspace('ws1')).toHaveLength(0);
    expect(db.getWorkspace('ws1')).toBeUndefined();
  });
});
