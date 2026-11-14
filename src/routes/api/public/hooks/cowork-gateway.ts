import { createFileRoute } from "@tanstack/react-router";

/**
 * Answers messages people sent Co-Work by text, email or Telegram
 * (lib/cowork-gateway). Called every minute by pg_cron with the project apikey
 * header (docs/cowork-gateways.sql); the follow-ups hook is the fallback.
 */
export const Route = createFileRoute("/api/public/hooks/cowork-gateway")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "") ??
          "";
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";
        if (!expected || apiKey !== expected) return new Response("Unauthorized", { status: 401 });
        const { sweepGateways } = await import("@/lib/cowork-gateway.server");
        const result = await sweepGateways().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Co-Work gateways failed",
        }));
        return Response.json(result);
      },
    },
  },
});
