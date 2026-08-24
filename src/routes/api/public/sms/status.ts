import { createFileRoute } from "@tanstack/react-router";

/** Delivery status callback webhook. */
export const Route = createFileRoute("/api/public/sms/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        const payload: Record<string, unknown> = contentType.includes("application/json")
          ? ((await request.json()) as Record<string, unknown>)
          : Object.fromEntries((await request.formData()).entries());

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleDeliveryStatus } = await import("@/lib/lead-engine.server");

        const eventId = `${String(payload["MessageSid"] ?? "")}:${String(payload["MessageStatus"] ?? payload["SmsStatus"] ?? "")}`;
        if (eventId === ":") {
          return Response.json({ ok: false, error: "Missing message id" }, { status: 400 });
        }

        const { error: dedupeError } = await supabaseAdmin
          .from("webhook_events")
          .insert({ provider: "twilio", event_id: eventId, event_type: "status", payload: payload as never });
        if (dedupeError) return Response.json({ ok: true, duplicate: true });

        const result = await handleDeliveryStatus({ providerName: "twilio", payload: payload as never });
        return Response.json(result);
      },
    },
  },
});
