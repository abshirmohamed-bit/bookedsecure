import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled pilot expiry pass. Paid pilots whose 30-day window has elapsed
 * lose live-sending access immediately. Safe to run repeatedly.
 */
export const Route = createFileRoute("/api/public/hooks/pilot-expiry")({
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

        const { processPilotExpiry } = await import("@/lib/billing.server");
        const result = await processPilotExpiry();
        return Response.json(result);
      },
    },
  },
});
