import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { takeOAuthReturn } from "@/lib/oauth-return-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Signing you in | BookedSecure" },
      {
        name: "description",
        content: "Finishing sign-in to your BookedSecure dashboard.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CallbackPage,
});

/**
 * Google and Apple hand the browser back here once the owner has approved.
 * The session needs a moment to land, so this page waits for it and then hands
 * off to the sign-in page, which decides where the owner goes next.
 */
function CallbackPage() {
  const navigate = useNavigate();
  const intended = useRef<string | null | undefined>(undefined);
  const settled = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (intended.current === undefined) intended.current = takeOAuthReturn();
    let cancelled = false;

    const finish = () => {
      if (settled.current || cancelled) return;
      settled.current = true;
      const target = intended.current ?? null;
      navigate({
        to: "/auth",
        search: target ? { next: target } : {},
        replace: true,
      });
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        finish();
        return;
      }
      if (attempts >= 15) {
        window.clearInterval(timer);
        if (!cancelled && !settled.current) setFailed(true);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      subscription.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6 text-center">
        {failed ? (
          <>
            <h1 className="font-heading text-lg font-semibold">
              That sign-in didn't finish
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We couldn't confirm your account with the provider. You can try
              again, or sign in with your email instead.
            </p>
            <Button
              type="button"
              className="mt-5 w-full"
              onClick={() => navigate({ to: "/auth", replace: true })}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <div
              className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm text-muted-foreground">
              Signing you in…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
