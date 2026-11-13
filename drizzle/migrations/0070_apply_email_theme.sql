-- Email template (Outreach → Inbox → your address → Email template).
-- A business's own email look: colours, font, logo placement, button shape and a
-- footer line, validated by src/lib/email-theme.ts. Design values only, never HTML.
-- Written by the server after an owner check; read by the server when sending.
-- Until this is applied, every email keeps the BookedSecure look.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS email_theme jsonb;

COMMENT ON COLUMN public.businesses.email_theme IS
  'Owner-uploaded email template (lib/email-theme): colors, font, logo, buttons, corners, footerNote. Null = BookedSecure default.';