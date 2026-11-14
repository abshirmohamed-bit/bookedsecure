# Message Co-Work by text, email or Telegram

Each person links their own phone, email or Telegram in Co-Work (phone button beside the history). Co-Work answers there, reading records and preparing drafts; anything that sends, posts, books or changes waits for Confirm in Co-Work.

## 1. Database (Lovable)
Apply `docs/cowork-gateways.sql` (the server-only tables; done 14 Nov), then `docs/cowork-gateways-trigger.sql`: an insert trigger that calls `/api/public/hooks/cowork-gateway` through pg_net the moment a message is queued, with its own secret (`COWORK_GATEWAY_SECRET` in the app's secrets and `cowork_gateway_secret` in the database's Vault; the file says how). No timer and no public key. Without the trigger, messages are answered by the 10-minute follow-ups hook.

## 2. Text messages
Nothing to set up. The person texts the business's own number from their verified mobile, and each answer is up to 3 texts using the business's credits. Texting PAUSE or STOP pauses it.

## 3. Email
Nothing to set up. Mail arrives through the existing Resend receiving webhook. Only mail to the person's private `cowork-<token>@bookedsecure.com` from their verified address is answered, and automatic mail (out-of-office, bounces, lists) never is.

## 4. Telegram (optional)
1. In Telegram, message @BotFather, send `/newbot`, and name it (e.g. BookedSecure). Copy the token.
2. Add these Lovable secrets:
   - `TELEGRAM_BOT_TOKEN`: the token.
   - `TELEGRAM_WEBHOOK_SECRET`: any long random string (letters, numbers, `_` and `-`, up to 256 characters).
   - `TELEGRAM_BOT_USERNAME` (optional): the bot's username without the @.
3. Publish. The first time someone presses Connect Telegram, BookedSecure points the bot at `/api/public/telegram/webhook` itself.

Bot commands: `/new` starts a fresh conversation, `/stop` disconnects.
