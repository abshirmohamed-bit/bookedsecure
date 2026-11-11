import { createFileRoute } from "@tanstack/react-router";

/**
 * Google redirects here after an owner signs in to connect Google Ads. The
 * signed `state` identifies the business and owner. Only a short outcome code
 * goes back in the address, never tokens or Google's own messages.
 */
export const Route = createFileRoute("/api/public/google-ads/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readYouTubeConfig } = await import("@/lib/youtube.server");
        const url = new URL(request.url);
        const back = (outcome: string) =>
          new Response(null, { status: 302, headers: { Location: `${readYouTubeConfig().appUrl}/ads?google=${outcome}`, "Cache-Control": "no-store" } });
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error") || !code) return back("denied");
        if (!state || code.length > 2048 || state.length > 1024) return back("failed");
        try {
          const { completeGoogleAdsConnect } = await import("@/lib/google-ads.server");
          return back(await completeGoogleAdsConnect(code, state));
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          console.error("google ads connect failed", message.slice(0, 120));
          return back(/expired/i.test(message) ? "expired" : /database update/i.test(message) ? "setup" : /allow/i.test(message) ? "scope" : "failed");
        }
      },
    },
  },
});
