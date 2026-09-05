ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS owner_notification_name text,
  ADD COLUMN IF NOT EXISTS owner_notification_number text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS recipient_role text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS to_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_recipient_role_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_recipient_role_check
      CHECK (recipient_role IN ('customer', 'owner'));
  END IF;
END $$;

UPDATE public.businesses
SET owner_notification_name = 'Usama Ahmed',
    owner_notification_number = '+61447852565'
WHERE id = '11111111-1111-1111-1111-111111111111';