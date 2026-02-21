import { describe, it, expect } from 'vitest';
import {
  validateStandupName,
  validateCronExpression,
  validateTime,
  validateQuestions,
  validateBlockerIndex,
  validateSnoozeDuration,
  validateParticipantCount,
  sanitizeForDisplay,
} from './validation';

describe('validateStandupName', () => {
  it('accepts valid names', () => {
    expect(validateStandupName('Daily Standup').valid).toBe(true);
    expect(validateStandupName('team-sync').valid).toBe(true);
    expect(validateStandupName('standup_v2').valid).toBe(true);
    expect(validateStandupName('A').valid).toBe(true);
  });

  it('rejects empty name', () => {
    expect(validateStandupName('').valid).toBe(false);
    expect(validateStandupName('   ').valid).toBe(false);
  });

  it('rejects names over 64 characters', () => {
    expect(validateStandupName('a'.repeat(65)).valid).toBe(false);
    expect(validateStandupName('a'.repeat(64)).valid).toBe(true);
  });

  it('rejects names with special characters', () => {
    expect(validateStandupName('test@standup').valid).toBe(false);
    expect(validateStandupName('test<script>').valid).toBe(false);
    expect(validateStandupName('test;DROP').valid).toBe(false);
  });
});

describe('validateCronExpression', () => {
  it('accepts valid 5-field cron', () => {
    expect(validateCronExpression('0 9 * * 1,2,3,4,5').valid).toBe(true);
    expect(validateCronExpression('30 14 * * *').valid).toBe(true);
  });

  it('rejects empty expression', () => {
    expect(validateCronExpression('').valid).toBe(false);
  });

  it('rejects 6-field (seconds) format', () => {
    expect(validateCronExpression('0 0 9 * * 1,2,3').valid).toBe(false);
  });

  it('rejects invalid expressions', () => {
    expect(validateCronExpression('not a cron').valid).toBe(false);
  });
});

describe('validateTime', () => {
  it('accepts valid times', () => {
    expect(validateTime(0, 0).valid).toBe(true);
    expect(validateTime(23, 59).valid).toBe(true);
    expect(validateTime(9, 30).valid).toBe(true);
  });

  it('rejects invalid hours', () => {
    expect(validateTime(-1, 0).valid).toBe(false);
    expect(validateTime(24, 0).valid).toBe(false);
    expect(validateTime(99, 0).valid).toBe(false);
  });

  it('rejects invalid minutes', () => {
    expect(validateTime(9, -1).valid).toBe(false);
    expect(validateTime(9, 60).valid).toBe(false);
    expect(validateTime(9, 99).valid).toBe(false);
  });
});

describe('validateQuestions', () => {
  it('accepts valid questions', () => {
    expect(validateQuestions(['What did you do?', 'What will you do?']).valid).toBe(true);
  });

  it('rejects empty question list', () => {
    expect(validateQuestions([]).valid).toBe(false);
  });

  it('rejects more than 20 questions', () => {
    const questions = Array.from({ length: 21 }, (_, i) => `Question ${i + 1}`);
    expect(validateQuestions(questions).valid).toBe(false);
  });

  it('rejects questions over 500 characters', () => {
    expect(validateQuestions(['a'.repeat(501)]).valid).toBe(false);
    expect(validateQuestions(['a'.repeat(500)]).valid).toBe(true);
  });

  it('rejects questions with control characters', () => {
    expect(validateQuestions(['test\x00question']).valid).toBe(false);
    expect(validateQuestions(['test\x1fquestion']).valid).toBe(false);
  });
});

describe('validateBlockerIndex', () => {
  it('accepts valid index', () => {
    expect(validateBlockerIndex(0, 3).valid).toBe(true);
    expect(validateBlockerIndex(2, 3).valid).toBe(true);
  });

  it('rejects out of bounds', () => {
    expect(validateBlockerIndex(3, 3).valid).toBe(false);
    expect(validateBlockerIndex(-1, 3).valid).toBe(false);
  });
});

describe('validateSnoozeDuration', () => {
  it('accepts valid durations', () => {
    expect(validateSnoozeDuration(1).valid).toBe(true);
    expect(validateSnoozeDuration(120).valid).toBe(true);
    expect(validateSnoozeDuration(30).valid).toBe(true);
  });

  it('rejects invalid durations', () => {
    expect(validateSnoozeDuration(0).valid).toBe(false);
    expect(validateSnoozeDuration(121).valid).toBe(false);
    expect(validateSnoozeDuration(-5).valid).toBe(false);
    expect(validateSnoozeDuration(480).valid).toBe(false);
  });
});

describe('validateParticipantCount', () => {
  it('accepts within limit', () => {
    expect(validateParticipantCount(0).valid).toBe(true);
    expect(validateParticipantCount(199).valid).toBe(true);
  });

  it('rejects over limit', () => {
    expect(validateParticipantCount(200).valid).toBe(false);
    expect(validateParticipantCount(199, 2).valid).toBe(false);
  });
});

describe('sanitizeForDisplay', () => {
  it('strips control characters', () => {
    expect(sanitizeForDisplay('test\x00\x1fvalue')).toBe('testvalue');
  });

  it('truncates to max length', () => {
    expect(sanitizeForDisplay('a'.repeat(50))).toBe('a'.repeat(32));
    expect(sanitizeForDisplay('a'.repeat(50), 10)).toBe('a'.repeat(10));
  });
});
