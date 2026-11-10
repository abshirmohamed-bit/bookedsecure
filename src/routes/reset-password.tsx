import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readRecoveryLink } from "@/lib/password-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password | BookedSecure" },
      {
        name: "description",
        content: "Set a new password for your BookedSecure team account.",
      },
      { property: "og:title", content: "Choose a new password | BookedSecure" },
      {
        property: "og:description",
        content: "Set a new password for your BookedSecure team account.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid" | "saving" | "done";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const settled = useRef(false);

  useEffect(() => {
    // The link is only readable in the browser, so nothing is decided until here.
    const link = readRecoveryLink(window.location.hash);
    const subscription = supabase.auth.onAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY" && event !== "SIGNED_IN") return;
      if (link !== "none") {
        settled.current = true;
        setStatus("ready");
      }
    });

    // Opening the link should sign the visit in for this one job. Poll for it so
    // a slow exchange still lands, and give up rather than hang on a dead link.
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const { data } = await supabase.auth.getUser();
      if (data.user && link !== "none") {
        settled.current = true;
        setStatus("ready");
        clearInterval(timer);
        return;
      }
      if (attempts >= 15) {
        clearInterval(timer);
        if (!settled.current) setStatus("invalid");
      }
    }, 400);

    return () => {
      clearInterval(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Those two passwords don't match.");
      return;
    }
    setStatus("saving");
    // A recovery visit is exempt from the current-password rule, so only the new
    // one is sent.
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message || "Could not save the new password.");
      setStatus("ready");
      return;
    }
    setStatus("done");
    toast.success("Password updated.");
    setTimeout(() => navigate({ to: "/dashboard", replace: true }), 1200);
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="brand-wash hidden border-r border-border p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="font-heading text-lg font-semibold">BookedSecure</div>
        <div className="max-w-xl">
          <p className="text-sm font-medium text-primary">Account security</p>
          <h1 className="mt-4 font-heading text-5xl font-semibold leading-tight">
            Choose a new password.
          </h1>
          <div className="mt-8 grid gap-3 text-sm text-muted-foreground">
            <p className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" /> Only this link can set it
            </p>
            <p className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" /> Your leads and bookings stay as they are
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Built for Australian service businesses.</p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="panel w-full max-w-sm overflow-hidden">
          <div className="border-b border-border p-5">
            <h1 className="text-base font-semibold">New password</h1>
            <p className="text-xs text-muted-foreground">
              {status === "done"
                ? "Your password is changed."
                : status === "invalid"
                  ? "That link has expired."
                  : "Set the password you want to use from now on."}
            </p>
          </div>

          {status === "checking" ? (
            <div className="p-5 text-sm text-muted-foreground">Checking your link…</div>
          ) : null}

          {status === "invalid" ? (
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                Reset links only work once and expire quickly. Ask for a new one and try again.
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">Send me a new link</Link>
              </Button>
            </div>
          ) : null}

          {status === "done" ? (
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                You&rsquo;re signed in with your new password. Taking you to your dashboard…
              </p>
              <Button asChild className="w-full">
                <Link to="/dashboard">Go to my dashboard</Link>
              </Button>
            </div>
          ) : null}

          {status === "ready" || status === "saving" ? (
            <form onSubmit={submit} className="space-y-4 p-5">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">New password</span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Confirm new password</span>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <Button type="submit" disabled={status === "saving"} className="w-full">
                {status === "saving" ? "Saving…" : "Save new password"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
