import { createFileRoute } from "@tanstack/react-router";

/**
 * Answers messages people sent Co-Work by text, email or Telegram
 * (lib/cowork-gateway), straight away. Called by the database the moment a
 * message is queued (docs/cowork-gateways-trigger.sql: an insert trigger on
 * cowork_gateway_messages, through pg_net), never on a timer. It is protected
 * by its own secret, COWORK_GATEWAY_SECRET, sent in x-cowork-gateway-secret
 * and kept in the database's Vault; the public key is not accepted. The
 * 10-minute follow-ups hook stays as the fallback.
 */
export const Route = createFileRoute("/api/public/hooks/cowork-gateway")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { gatewayHookAuthorised } = await import("@/lib/cowork-gateway");
        if (!gatewayHookAuthorised(request.headers.get("x-cowork-gateway-secret"), process.env["COWORK_GATEWAY_SECRET"])) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { sweepGateways } = await import("@/lib/cowork-gateway.server");
        // Drain what's waiting (a second message from the same person follows its first).
        const result = await sweepGateways({ budgetMs: 60_000 }).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Co-Work gateways failed",
        }));
        return Response.json(result);
      },
    },
  },
});
