import { createFileRoute } from "@tanstack/react-router";

/**
 * Telegram bot webhook (Co-Work on Telegram). Telegram sends our secret in
 * X-Telegram-Bot-Api-Secret-Token (TELEGRAM_WEBHOOK_SECRET, set with
 * setWebhook); anything without it is refused. Messages are only queued here;
 * the every-minute gateway hook answers them.
 */
export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["TELEGRAM_WEBHOOK_SECRET"] ?? "";
        const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        const { safeEqual } = await import("@/lib/cowork-gateway");
        if (!expected || !safeEqual(got, expected)) return new Response("Unauthorized", { status: 401 });
        const update = (await request.json().catch(() => null)) as Parameters<typeof import("@/lib/cowork-gateway.server").handleTelegramUpdate>[0] | null;
        if (!update || typeof update.update_id !== "number") return Response.json({ ok: true });
        try {
          const { handleTelegramUpdate } = await import("@/lib/cowork-gateway.server");
          const result = await handleTelegramUpdate(update);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          console.error("[telegram] update failed", error);
          // A 5xx makes Telegram retry; the queue's one-row-per-update key keeps that safe.
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
