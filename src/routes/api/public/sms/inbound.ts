import { createFileRoute } from "@tanstack/react-router";

/** Inbound SMS webhook (Twilio-compatible form body or JSON). */
export const Route = createFileRoute("/api/public/sms/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = await readPayload(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleInboundMessage } = await import("@/lib/lead-engine.server");

        const eventId = String(payload["MessageSid"] ?? payload["message_id"] ?? "");
        if (!eventId) return Response.json({ ok: false, error: "Missing message id" }, { status: 400 });

        // De-duplicate provider retries before doing any work.
        const { error: dedupeError } = await supabaseAdmin
          .from("webhook_events")
          .insert({ provider: "twilio", event_id: eventId, event_type: "inbound", payload: payload as never });
        if (dedupeError) return Response.json({ ok: true, duplicate: true });

        const result = await handleInboundMessage({ providerName: "twilio", payload: payload as never });
        return Response.json(result, { status: result.handled ? 200 : 202 });
      },
    },
  },
});

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
