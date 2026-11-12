import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled endpoint that sends every follow-up currently due.
 * Called by pg_cron with the project apikey header.
 */
export const Route = createFileRoute("/api/public/hooks/follow-ups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "") ??
          "";
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";
        if (!expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { processDueFollowUps } = await import("@/lib/lead-engine.server");
        const { processDueReactivationReminders } = await import("@/lib/reactivation.server");
        const { sweepAbandonedConversations } = await import("@/lib/quote-funnel.server");
        const result = await processDueFollowUps();
        const reminders = await processDueReactivationReminders();
        // Measurement housekeeping: quiet quote conversations stop counting as
        // live. No message is ever sent by this sweep.
        const swept = await sweepAbandonedConversations();
        const { processDueOwnerReminders } = await import("@/lib/owner-schedule-reminder.server");
        const ownerReminders = await processDueOwnerReminders();
        // Scheduled email campaigns and due campaign follow-ups. A failure here
        // is reported but never blocks the lead follow-ups above.
        const { processDueEmailCampaigns } = await import("@/lib/email-campaigns.server");
        const emailCampaigns = await processDueEmailCampaigns().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Email campaigns failed",
        }));
        // Facebook and Instagram posts scheduled for now or earlier.
        const { processDueScheduledPosts } = await import("@/lib/meta-publish.server");
        const scheduledPosts = await processDueScheduledPosts().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Scheduled posts failed",
        }));
        // Video clips whose Engine webhook was lost.
        const { advanceAllVideoJobs } = await import("@/lib/video-clips.server");
        await advanceAllVideoJobs().catch((error: unknown) => console.error("video clips", error));
        // Review requests after completed jobs, once per job, for businesses that turn them on.
        const { processDueReviewRequests } = await import("@/lib/review-requests.server");
        const reviewRequests = await processDueReviewRequests().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Review requests failed",
        }));
        // Service reminders an interval after a customer's last completed job, once per job.
        const { processDueServiceReminders } = await import("@/lib/service-reminders.server");
        const serviceReminders = await processDueServiceReminders().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Service reminders failed",
        }));
        // Customer appointment reminders, once per booking, for businesses that switch them on.
        const { processDueCustomerReminders } = await import("@/lib/customer-reminder.server");
        const customerReminders = await processDueCustomerReminders().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Customer reminders failed",
        }));
        // Booked jobs whose time has passed, for businesses that complete jobs automatically.
        const { retryFailedBookingEmails } = await import("@/lib/booking-email.server");
        const bookingEmails = await retryFailedBookingEmails().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Booking email retry failed",
        }));
        const { sweepGoogleAdSpend } = await import("@/lib/google-ads.server");
        const googleAds = await sweepGoogleAdSpend().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Google Ads sync failed",
        }));
        const { sweepPostInsights } = await import("@/lib/social-planner.server");
        const postInsights = await sweepPostInsights().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Post insights failed",
        }));
        const { processDueAutoCompletions } = await import("@/lib/job-autocomplete.server");
        const autoCompleted = await processDueAutoCompletions().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Auto-complete failed",
        }));
        // Platform admins hear, at most weekly, when the Engine's YouTube proxy needs an ISP plan (never wakes the Engine).
        const { checkProxyUpgrade } = await import("@/lib/engine-proxy.server");
        const proxyUpgrade = await checkProxyUpgrade().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Proxy check failed",
        }));
        return Response.json({ ...result, reminders, ownerReminders, emailCampaigns, customerReminders, reviewRequests, serviceReminders, scheduledPosts, autoCompleted, bookingEmails, googleAds, postInsights, proxyUpgrade, abandonedSwept: swept.swept });


      },
    },
  },
});
