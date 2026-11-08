<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Enforce deleted-lead slot release and reject booking writes to deleted leads in database triggers, preserving historical job rows; this covers all entry points and concurrent requests.
- Schedule owner-entered jobs through a tenant-scoped atomic database function and propagate failures before reporting success; the job and lead state must commit together.
- External assistants use OAuth-protected MCP in src/lib/mcp with one tool per file and the generated TanStack transport; never expose browser-session tokens or use admin clients in MCP tools.
- MCP mutations use caller-authorized database RPCs with tenant identity derived from auth.uid(), owner/subscription checks and atomic auditing; browser-local tools stay separate and use the telemetry wrapper.
- Cowork and MCP share typed customer/catalog/settings actions in assistant-shared-actions; text requests reuse the proposal contract and require the existing in-app Confirm flow, so external callers cannot bypass SMS safeguards.
- Cowork and MCP share operational contracts and the atomic assistant_operational_action RPC; broader privileged work is queued as an assistant_request and runs through existing Cowork only after in-app confirmation, preserving downstream approvals.
- External MCP read tools use bounded, explicit-column caller-scoped queries with pagination or exact counts; propagate read errors rather than reporting missing data as empty records.
- Connection diagnostics verify current-account OAuth grants and bounded RLS-scoped customer reads separately from external-client tool calls; never treat browser readiness as proof of a ChatGPT MCP call.
- Tenant AI keys are encrypted with tenant/provider/model-bound authenticated encryption in a server-only table; owner-verified server functions return connection metadata only.
- AI provider fallback uses a durable workspace credit-pause state and only confirmed credit exhaustion; never replay agent turns once tools start or switch providers for policy denials.
- All AI calls route through withAiBackup in tenant-ai.server.ts: the platform-admin-selected primary (Lovable or the OpenAI-compatible external provider) first, then Lovable standby, then tenant keys; switch only for credits/outage before tools start, so actions never run twice.
- Owner schedule reminder texts are queued via the caller-authorized schedule_owner_sms_reminder RPC and delivered by the existing 10-minute follow-ups hook, which re-reads bookings at send time; they bypass the customer messages table and never touch booking confirmations.
- Cowork passes the complete authorised thread with completion/approval context; never pool raw tenant transcripts into shared prompts, and never run the orchestration fallback after tools start, because interrupted turns may have committed changes.
- Campaign audience corrections are enforced from the owner's latest request in the tool wrapper; all-existing-lead requests never narrow to uncontacted records, and eligibility is distinct from owner-attested permission. Recheck campaign contact blocks at approval because saved drafts can become stale.
- Cowork checks vague campaign requests before its agent loop and again at campaign tool boundaries; return clarification without mutations so model-selected recipients cannot authorise an unspecified campaign.
- Cowork import summaries use mutually exclusive row-level categories for its mobile-only action, not overlapping CSV validation/duplicate counters, so displayed totals match the records.
- Owner alerts from database events go through push_owner_notification triggers that honour notification_preferences mutes and idempotency keys; time-based alerts are raised on read.
- Assistant booking actions return what the database saved (saved, outcome, time, service, status) and Cowork reports that summary; same-customer same-time bookings update in place, other customers' slots are refused, and create_customer reuses an active customer with the same number.
- The universal REST API lives under src/routes/api/public/v1 and authenticates owner-created API keys stored only as SHA-256 hashes, enforcing scope, rate limit and active subscription per request before any tenant-filtered work; MCP stays the OAuth path for AI assistants.
- Social comment review lives in BookedSecure (social_comments + /social), fed by Make via the social:write API scope; comments never become leads automatically and replies post only after owner approval, because commenters have no mobile or SMS consent.
- Facebook lead import is direct only (Make import removed): per-business lead_sync_* runs/items/form checkpoints, provider meta_direct, applied in-process by applyRunBatch with the connected Page id; checkpoints advance only when no lead needs retry.
- Instant Facebook leads: /api/public/meta/webhook (X-Hub-Signature-256 HMAC with META_APP_SECRET) calls importWebhookLead per leadgen event; webhook runs (trigger_kind 'webhook', falls back to 'schedule') never advance checkpoints, so the five-minute sweep stays the safety net. Pages are subscribed to leadgen on connect.
- Direct Facebook import (provider meta_direct) is per business: owners Connect Facebook (signed-state OAuth, /api/public/meta/oauth/callback), and only the chosen Page token is kept, AES-GCM-encrypted and bound to business+Page in server-only meta_lead_accounts; no tenant ids in code. Runs share the five-minute lead-sync sweep and applyRunBatch, and record failures/pausing per connection. Platform secrets META_APP_ID/META_APP_SECRET/META_LOGIN_CONFIG_ID; setup in docs/meta-direct-setup.md.
- New-enquiry owner jobs send data-only FCM through the connector to owner-scoped devices with durable per-alert reservations; SMS fallback is opt-in and suppressed after accepted or uncertain push, preventing replay and credit waste. The messaging worker is not an offline cache.
- Installed-app caching uses generated Workbox /sw.js scoped to the existing manifest launch path /dashboard, preserving the root Firebase push registration; precache static code only, never tenant data/HTML/API/OAuth, and register only through the preview-guarded pwa-registration module.
- Facebook Lead Ads replies live in facebook-lead-response(.server).ts, called from the lead-sync importer: one reply per Meta submission (idempotency key), routed through the existing acknowledgement job/sendSms guards, so opt-out, quiet hours and credits stay enforced in one place.
