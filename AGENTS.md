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
- External MCP read tools use bounded, explicit-column caller-scoped queries with pagination or exact counts; propagate read errors rather than reporting missing data as empty records.
- Connection diagnostics verify current-account OAuth grants and bounded RLS-scoped customer reads separately from external-client tool calls; never treat browser readiness as proof of a ChatGPT MCP call.
- Tenant AI keys are encrypted with tenant/provider/model-bound authenticated encryption in a server-only table; owner-verified server functions return connection metadata only.
- AI provider fallback uses a durable workspace credit-pause state and only confirmed credit exhaustion; never replay agent turns once tools start or switch providers for policy denials.
- All AI calls route through withAiBackup in tenant-ai.server.ts: the platform-admin-selected primary (Lovable or the OpenAI-compatible external provider) first, then Lovable standby, then tenant keys; switch only for credits/outage before tools start, so actions never run twice.
