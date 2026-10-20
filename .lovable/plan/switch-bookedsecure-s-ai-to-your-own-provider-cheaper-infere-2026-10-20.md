# Switch BookedSecure's AI to your own provider (Cheaper Inference)

Goal: both assistants (owner chat and customer quote chat) keep doing exactly what they do today: same tools, safeguards, prices, bookings and approvals. Only the AI provider and model change.

## What changes for you
- One BookedSecure-wide AI key (your Cheaper Inference key) powers every business. Businesses don't need their own key. Their optional backup keys keep working.
- The Control room gets an "AI provider" card where you can pick Primary: Cheaper Inference, Lovable, or Off. It shows a health check and the latest test results. You can switch back with one click.
- Lovable stays available as a standby until the tests pass. After that you can turn it off fully.

## Steps
1. **Store the key securely.** You'll get a secure form for your Cheaper Inference key. It is never shown in code or chat.
2. **One switchboard for all AI calls.** Every place that uses AI goes through one provider router:
   - Owner chat
   - Quote chat
   - Lead-detail extraction from chats
   - Reactivation offer drafting
   - Email campaign drafts
   - Owner assistant summaries
   - Website-import AI steps
   Nothing calls Lovable directly anymore.
3. **Primary/fallback rules.** The selected primary is tried first. A fallback only happens before any action has run, and only for credit exhaustion or an outage. A refusal or an access denial never switches providers. An action is never run twice.
4. **Compatibility layer.** Cheaper Inference accepts the standard request format the app already uses. I'll handle the gaps in that format:
   - Tool calls
   - Streaming
   - Structured answers
   - Reasoning settings, which are dropped where unsupported
   - Error codes, mapped to the existing safe customer messages
5. **Model choice per job.** A fast model handles the quote chat and extraction. A stronger model handles owner chat. Both are configurable in the Control room.
6. **Automated tests, without live AI calls.** These cover routing, fallback, no-replay, error mapping, tool-call shape and streaming with split frames.
7. **Live action tests, run with your approval on a test business:**
   - Quote chat: list services, save the enquiry, offer real times, confirm a booking, hand off to the owner
   - Owner chat: update a lead, edit a service, prepare a campaign draft, schedule a job
   - Check that prices and availability still come from your data, not the AI
8. **Cutover.** Set Cheaper Inference as primary and watch real conversations for 48 hours with error and cost tracking. Then you can turn Lovable to Off.

## Things to be aware of
- A different model can do the same actions, but its wording and judgement may differ. The live tests check this.
- If Cheaper Inference has an outage while Lovable is Off, the quote chat shows its existing "we'll get back to you" message and flags the conversation for you.
- Lovable still hosts the app and database. Only the AI moves.

## Technical details
- New `src/lib/ai-router.server.ts` uses an OpenAI-compatible provider (`@ai-sdk/openai` `createOpenAI({ baseURL })`) with the secret read inside the handlers. `ai_gateway_state` is extended with `primary_provider` and the per-role models. Changing them requires a platform-admin server function.
- `withAiBackup` is generalised to `withAiRouting`, which keeps the existing canReplay/tool-boundary logic. Tenant BYOK stays as the last fallback.
- All current call sites are migrated: agent-core, web-chat-ai-extraction, reactivation, owner-assistant, ai.server, email-campaigns, site-onboarding. An `rg` check confirms no direct gateway calls remain.
- The usage events record the provider and cost so Control room costs stay accurate.
- The tests extend tenant-ai-backup.test.ts and add ai-router.test.ts.
