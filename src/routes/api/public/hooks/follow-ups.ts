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
        const result = await processDueFollowUps();
        return Response.json(result);
      },
    },
  },
});
