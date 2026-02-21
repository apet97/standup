import cron from 'node-cron';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const STANDUP_NAME_RE = /^[\w\s-]+$/;
const MAX_STANDUP_NAME_LENGTH = 64;
const MAX_QUESTION_LENGTH = 500;
const MAX_QUESTIONS = 20;
const MAX_SNOOZE_MINUTES = 120;
const MAX_PARTICIPANTS = 200;

export function validateStandupName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'Standup name is required.' };
  }
  if (trimmed.length > MAX_STANDUP_NAME_LENGTH) {
    return { valid: false, error: `Standup name must be ${MAX_STANDUP_NAME_LENGTH} characters or less.` };
  }
  if (!STANDUP_NAME_RE.test(trimmed)) {
    return { valid: false, error: 'Standup name can only contain letters, numbers, spaces, hyphens, and underscores.' };
  }
  return { valid: true };
}

export function validateCronExpression(expr: string): ValidationResult {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { valid: false, error: 'Cron expression is required.' };
  }
  // Must be 5-field format (no seconds)
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: 'Cron expression must have exactly 5 fields (minute hour day month weekday).' };
  }
  if (!cron.validate(trimmed)) {
    return { valid: false, error: 'Invalid cron expression.' };
  }
  return { valid: true };
}

export function validateTime(hour: number, minute: number): ValidationResult {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { valid: false, error: 'Hour must be between 0 and 23.' };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { valid: false, error: 'Minute must be between 0 and 59.' };
  }
  return { valid: true };
}

export function validateQuestions(questions: string[]): ValidationResult {
  if (questions.length === 0) {
    return { valid: false, error: 'At least one question is required.' };
  }
  if (questions.length > MAX_QUESTIONS) {
    return { valid: false, error: `Maximum ${MAX_QUESTIONS} questions allowed.` };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    if (q.length > MAX_QUESTION_LENGTH) {
      return { valid: false, error: `Question ${i + 1} exceeds ${MAX_QUESTION_LENGTH} characters.` };
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(q)) {
      return { valid: false, error: `Question ${i + 1} contains invalid control characters.` };
    }
  }
  return { valid: true };
}

export function validateBlockerIndex(index: number, questionCount: number): ValidationResult {
  if (!Number.isInteger(index) || index < 0 || index >= questionCount) {
    return { valid: false, error: `Blocker question number must be between 1 and ${questionCount}.` };
  }
  return { valid: true };
}

export function validateSnoozeDuration(minutes: number): ValidationResult {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
    return { valid: false, error: `Snooze duration must be between 1 and ${MAX_SNOOZE_MINUTES} minutes.` };
  }
  return { valid: true };
}

export function validateParticipantCount(current: number, adding: number = 1): ValidationResult {
  if (current + adding > MAX_PARTICIPANTS) {
    return { valid: false, error: `Maximum ${MAX_PARTICIPANTS} participants per standup.` };
  }
  return { valid: true };
}

export function sanitizeForDisplay(input: string, maxLength: number = 32): string {
  return input.replace(/[\x00-\x1f\x7f]/g, '').slice(0, maxLength);
}
