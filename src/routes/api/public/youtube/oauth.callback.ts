import { createFileRoute } from "@tanstack/react-router";

/**
 * Google redirects here after an owner signs in to connect YouTube for
 * uploading. The signed `state` identifies the business and owner. Only a short
 * outcome code goes in the return address, never tokens or provider messages.
 */
export const Route = createFileRoute("/api/public/youtube/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readYouTubeConfig, YouTubeError } = await import("@/lib/youtube.server");
        const url = new URL(request.url);
        const back = (outcome: string, why?: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `${readYouTubeConfig().appUrl}/social?platform=youtube&youtube=${outcome}${why ? `&why=${encodeURIComponent(why)}` : ""}`,
              "Cache-Control": "no-store",
            },
          });
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error") || !code) return back("denied");
        if (!state || code.length > 2048 || state.length > 1024) return back("failed");
        try {
          const { completeYouTubeConnect } = await import("@/lib/youtube.server");
          return back(await completeYouTubeConnect(code, state));
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          const why = e instanceof YouTubeError ? e.reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 60) : "unexpected";
          console.error("youtube connect failed", why);
          if (/expired/i.test(message) && !(e instanceof YouTubeError)) return back("expired");
          return back("failed", why);
        }
      },
    },
  },
});
