export interface Workspace {
  id: string;
  bot_token: string;
  bot_user_id: string;
  app_key: string;
  installed_at: string;
  active: number;
}

export interface Standup {
  id: number;
  workspace_id: string;
  name: string;
  channel_id: string;
  channel_name: string;
  cron_expr: string;
  timezone: string;
  reminder_mins: number;
  cutoff_mins: number;
  active: number;
  created_by: string;
  created_at: string;
}

export interface StandupWithCount extends Standup {
  participant_count: number;
}

export interface NewStandup {
  workspace_id: string;
  name: string;
  channel_id: string;
  channel_name: string;
  cron_expr: string;
  timezone: string;
  reminder_mins: number;
  cutoff_mins: number;
  created_by: string;
}

export interface Question {
  id: number;
  standup_id: number;
  sort_order: number;
  text: string;
  is_blocker: number;
}

export interface NewQuestion {
  text: string;
  sort_order: number;
  is_blocker: number;
}

export interface Run {
  id: number;
  standup_id: number;
  status: 'COLLECTING' | 'COMPLETE' | 'INTERRUPTED';
  triggered_by: string;
  triggered_at: string;
  completed_at: string | null;
  summary_msg_id: string | null;
  summary_channel_id: string | null;
}

export interface RunSummary {
  id: number;
  triggered_at: string;
  status: string;
  triggered_by: string;
  response_count: number;
  total_participants: number;
}

export interface Response {
  id: number;
  run_id: number;
  user_id: string;
  answers: string;
  responded_at: string;
  is_skipped: number;
  is_late: number;
  streak: number;
}

export interface ParsedResponse extends Omit<Response, 'answers'> {
  answers: string[];
}

export interface PendingPrompt {
  runId: number;
  standupId: number;
  userId: string;
  channelId: string;
  messageId: string;
  sentAt: Date;
  questions: Question[];
  workspaceId: string;
}

export interface ActiveRun {
  runId: number;
  standupId: number;
  standup: Standup;
  questions: Question[];
  participants: string[];
  reminderTimer?: NodeJS.Timeout | undefined;
  cutoffTimer?: NodeJS.Timeout | undefined;
}

export interface BlockerEntry {
  user_id: string;
  blocker_text: string;
}
