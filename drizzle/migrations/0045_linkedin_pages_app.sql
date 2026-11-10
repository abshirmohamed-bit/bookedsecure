-- Company Page posting on LinkedIn uses a second LinkedIn app, because LinkedIn
-- requires Company Page access (Community Management) to be the only product on
-- its app. That app's token is kept on the business's existing LinkedIn
-- connection, encrypted and server-only like the profile token.
ALTER TABLE public.linkedin_accounts
  ADD COLUMN IF NOT EXISTS pages_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS pages_token_expires_at timestamptz;
