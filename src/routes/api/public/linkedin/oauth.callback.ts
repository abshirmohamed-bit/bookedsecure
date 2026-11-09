import { createFileRoute } from "@tanstack/react-router";

/**
 * LinkedIn redirects here after an owner signs in to connect LinkedIn for
 * posting. The signed `state` identifies the business and owner. Only a short
 * outcome code goes in the return address, never tokens or provider messages.
 */
export const Route = createFileRoute("/api/public/linkedin/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readLinkedInConfig, LinkedInError } = await import("@/lib/linkedin.server");
        const url = new URL(request.url);
        const back = (outcome: string, why?: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `${readLinkedInConfig().appUrl}/linkedin?linkedin=${outcome}${why ? `&why=${encodeURIComponent(why)}` : ""}`,
              "Cache-Control": "no-store",
            },
          });
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error") || !code) return back("denied");
        if (!state || code.length > 2048 || state.length > 1024) return back("failed");
        try {
          const { completeLinkedInConnect } = await import("@/lib/linkedin.server");
          return back(await completeLinkedInConnect(code, state));
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          const why = e instanceof LinkedInError ? e.reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 60) : "unexpected";
          console.error("linkedin connect failed", why);
          if (/expired/i.test(message) && !(e instanceof LinkedInError)) return back("expired");
          return back("failed", why);
        }
      },
    },
  },
});
