import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The video Engine reports progress here, signed with ENGINE_WEBHOOK_SECRET in
 * x-crayz-signature as t=<unix seconds>,v1=<hex> over "<t>.<body>". Every valid
 * event gets a 200, including ones we ignore, because the Engine retries others.
 */
export const Route = createFileRoute("/api/public/hooks/engine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env["ENGINE_WEBHOOK_SECRET"];
        const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(request.headers.get("x-crayz-signature") ?? "");
        if (!secret || !match) return new Response("Invalid signature", { status: 400 });
        const t = Number(match[1]);
        if (Math.abs(Date.now() / 1000 - t) > 300) return new Response("Stale timestamp", { status: 400 });
        const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex"), "hex");
        const got = Buffer.from(match[2] ?? "", "hex");
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) return new Response("Invalid signature", { status: 400 });
        let event: { type?: unknown; data?: unknown };
        try { event = JSON.parse(raw); } catch { return new Response("Bad payload", { status: 400 }); }
        const { applyVideoEngineEvent } = await import("@/lib/video-clips.server");
        await applyVideoEngineEvent({ type: typeof event.type === "string" ? event.type : "", data: (event.data ?? null) as Record<string, unknown> | null });
        return new Response("ok", { status: 200 });
      },
    },
  },
});
