ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS follow_up_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.conversations.follow_up_overrides IS
  'Per-lead follow-up overrides keyed by step number: {"1": {"delay_minutes": 120, "message_template": "..."}}. Missing steps use the business-wide automation_rules row.';