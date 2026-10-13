/**
 * Public unsubscribe endpoint linked from every campaign email footer.
 * It only ever records an opt-out for the exact address in the link, so it
 * cannot be used to read or change anything else.
 */
import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function page(message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#1f2933;"><p>${message}</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/email-unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const businessId = url.searchParams.get("b") ?? "";
        const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
        if (!UUID.test(businessId) || !EMAIL_RE.test(email)) {
          return page("This unsubscribe link is not valid.");
        }
        const { recordUnsubscribe } = await import("@/lib/email-campaigns.server");
        await recordUnsubscribe(businessId, email);
        return page("You have been unsubscribed. You will not receive further emails from this business.");
      },
    },
  },
});
