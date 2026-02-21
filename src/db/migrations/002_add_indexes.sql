-- Additional indexes for performance
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(standup_id, status);
CREATE INDEX IF NOT EXISTS idx_responses_late ON responses(run_id, is_late);
