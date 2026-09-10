# Upcoming bookings calendar and new-booking alerts

## What the tenant gets

- A new **Bookings** page in the workspace with a month calendar of upcoming jobs, plus a "Next up" list for today and the coming week.
- Each day cell shows the jobs booked for that day (customer name, time, service).
- Tapping a job opens a detail view: customer name and phone, service booked, date and time, address/suburb, job state (scheduled, completed, cancelled), amount recorded when completed, notes, and a link straight to that customer's full record.
- New confirmed bookings arrive as alerts: the existing bell already receives a "New confirmed booking" alert, and it will now open the booking rather than just showing text, show a live count without a page refresh, and be reachable from the Bookings page too.
- The Assistant keeps answering booking questions, and its answers will be drawn from the same upcoming-bookings data the calendar shows, so words and calendar never disagree.

## What the data shows today (checked)

- Confirmed bookings are stored as jobs with a single start time and a state of `scheduled` or `completed`; there is no stored finish time, so the calendar shows start time only (no duration blocks) unless the tenant asks for that later.
- The service name on a scheduled job is empty until completion; the booked service name is held on the confirmed booking offer instead. The calendar will read the service name from the confirmed offer and fall back to the lead's requested service, so cards are never blank.
- "New confirmed booking" and "New lead" alerts are already being created correctly with customer, service and time.

## Assistant improvement

- Give the Assistant a read-only "upcoming bookings" answer path so "what's on this week", "who's booked tomorrow", "when is Andrew booked" answer from real rows, using the same service-name fallback.
- No change to the approval rule: anything that changes a booking still shows a preview and needs Confirm.

## Mobile and layout rules

- Calendar fits the screen width with no sideways page scrolling; the month grid becomes a compact agenda list on small screens.
- Job detail opens as a full-height sheet on phones and a centred window on desktop, with its own scroll area and a clear close control.
- All tap targets sized for phones.

## Technical details

- New authenticated server functions: upcoming/ranged bookings for the signed-in tenant (joins `jobs`, `booking_offers`, `leads`), and a single-booking detail read. Tenant scoping by `business_id` on every query; no new tables and no schema change needed.
- New routes `src/routes/bookings.index.tsx` (calendar + agenda) and a detail panel rendered in-page from the selected job id; sidebar entry added to the Workspace group in `AppShell.tsx`.
- Notification bell: link `booking_confirmed` alerts to the booking, shorten the refresh interval and invalidate on window focus.
- Assistant: extend the existing owner-question handling with a bookings lookup helper reusing the same server read.

## Verification

- Visual UI test with a real browser at phone, short-phone and desktop sizes: calendar renders, a day with several bookings is readable, job detail opens and closes, nothing overlaps, no sideways scrolling.
- Cross-check the calendar against the database rows for the tenant so dates, names and states match exactly.
- Full user-flow test of the public quote page: open it, pick a service group, select a service and an add-on, follow the AI replies through the questions, reach the time-slot step, and confirm prices/summary read correctly and the send control stays visible on a phone. Report what the AI actually said at each step and list any wording or flow problems found, with fixes.
- Typecheck, test suite and build checks.
