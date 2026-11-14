import { createFileRoute } from "@tanstack/react-router";

/**
 * Answers messages people sent Co-Work by text, email or Telegram
 * (lib/cowork-gateway), straight away. Called by the database the moment a
 * message is queued (docs/cowork-gateways-trigger.sql: an insert trigger on
 * cowork_gateway_messages, through pg_net), never on a timer. A call must
 * carry that message's own one-time key (kick_token, made when it was queued
 * and used up here) or the COWORK_GATEWAY_SECRET header; the public key is
 * not accepted. The 10-minute follow-ups hook stays as the fallback.
 */
export const Route = createFileRoute("/api/public/hooks/cowork-gateway")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { gatewayHookAuthorised } = await import("@/lib/cowork-gateway");
        const { claimKick, sweepGateways } = await import("@/lib/cowork-gateway.server");
        // Either the shared secret, or a queued message's own one-time key
        // (what the database trigger sends; it needs no secret of its own).
        const body = (await request.json().catch(() => ({}))) as { message_id?: unknown; token?: unknown };
        const allowed = gatewayHookAuthorised(request.headers.get("x-cowork-gateway-secret"), process.env["COWORK_GATEWAY_SECRET"])
          || (await claimKick(body.message_id, body.token));
        if (!allowed) return new Response("Unauthorized", { status: 401 });
        // Drain what's waiting (a second message from the same person follows its first).
        const result = await sweepGateways({ budgetMs: 60_000 }).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Co-Work gateways failed",
        }));
        return Response.json(result);
      },
    },
  },
});
