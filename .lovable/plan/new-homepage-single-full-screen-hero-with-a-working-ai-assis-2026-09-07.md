# New homepage: single full-screen hero with a working AI assistant

## What you'll get

A visitor to bookedsecure.com lands on one full-screen page (no scrolling sections, no second page): brand mark top-left, a few nav links, a sign-in action top-right, one large headline, and a prompt box in the middle — matching the dark, minimal layout you described, with all wording drawn from BookedSecure's own content instead of placeholder copy.

Behaviour on that page:

- **Already signed in** — the top-right action reads "Dashboard" and takes you to your lead inbox. If your browser has a saved session, you land already recognised, no login step.
- **Not signed in** — top-right reads "Get Started". Continue with Google is offered first, with email sign-in still available.
- **The prompt box works.** Signed-in owners can ask about their own business: new bookings, today's leads, which reactivation campaign is performing, what needs a reply. The answer is written from that business's own records only. Not signed in, sending a question takes you to sign-in first and asks it once you're in.
- **Your dashboard stays where it is** — it just moves off the root address to `/dashboard`, and `/` becomes the public homepage. The existing `/landing` marketing page is kept and reachable so nothing already shared breaks.

Everything is tenant-neutral: the assistant only ever sees the signed-in owner's own business data, enforced by the same database rules as the rest of the app.

## Guardrails on the assistant

- Read-only. It answers questions; it cannot send an SMS, create or change a booking, approve a campaign, or alter a lead.
- It answers only from stored records. No invented prices, availability, or promises — the existing content guards apply to its replies.
- One question per send, short answers, and a plain "I don't have that" when the data isn't there.

## Technical notes

- `src/routes/index.tsx` becomes the public hero homepage. The current dashboard body (`AppShell` + `LeadsWorkspace`) moves to a new `src/routes/dashboard.tsx`; existing in-app links and post-login redirects that point at `/` are updated to `/dashboard`.
- Hero is a new `src/components/home/HomeHero.tsx` (plus small subcomponents) using the project's Tailwind tokens — dark surface, single viewport height, the toolbar row and right-hand cluster laid out as specified, with the described entrance animation gated behind `prefers-reduced-motion` and torn down after it finishes.
- Auth state read through the existing `src/hooks/useAuth.ts`; top-right renders "Dashboard" or "Get Started" from it. Google sign-in uses `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`; the Google provider is configured in the same change so first use doesn't error. Session already present → no prompt.
- Assistant: new `src/lib/owner-assistant.ts` (pure: intent shaping, answer assembly, banned-claim guards, reusing `ai-guardrail`) and `src/lib/owner-assistant.server.ts` + a `createServerFn` in `src/lib/owner-assistant.functions.ts`. The server fn runs under `requireSupabaseAuth`, gathers counts/summaries via the caller's RLS-scoped client (leads, bookings, messages, `reactivation_drafts`/campaigns), and asks the existing Lovable AI model to phrase the answer from that snapshot only. No write paths, no `supabaseAdmin`.
- Unauthenticated submit stores the question in `sessionStorage` and redirects to `/auth`; after sign-in the homepage replays it once.
- `head()` on `/` gets its own homepage title/description/og text; `/dashboard` keeps the current lead-inbox metadata.

## Tests

- Pure-module tests for the assistant: guard rejection of price/availability/promise phrasing, empty-data answers, question routing.
- Server-boundary tests: unauthenticated call rejected; assistant cannot reach another business's rows; no send/booking/campaign side effects.
- Route tests: `/` renders the hero for a visitor, `/dashboard` renders the inbox, signed-in state flips the top-right action.
- Live check on localhost with a signed-in session: hero renders in one viewport, ask one question, confirm the answer and that no message or booking was created.
