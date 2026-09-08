import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, CheckCircle2, MessageSquareText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — BookedSecure" },
      {
        name: "description",
        content: "Sign in to your SMS lead response dashboard to manage detailing enquiries.",
      },
      { property: "og:title", content: "Sign in — BookedSecure" },
      {
        property: "og:description",
        content: "Team access to lead capture, SMS follow-up and completed-job reporting.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="brand-wash hidden border-r border-border p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="font-heading text-lg font-semibold">BookedSecure</div>
        <div className="max-w-xl">
          <p className="text-sm font-medium text-primary">
            Lead operations for detailing businesses
          </p>
          <h1 className="mt-4 font-heading text-5xl font-semibold leading-tight">
            Keep every enquiry moving towards a booking.
          </h1>
          <div className="mt-8 grid gap-3 text-sm text-muted-foreground">
            <p className="flex items-center gap-3">
              <MessageSquareText className="h-5 w-5 text-info-foreground" /> One organised lead
              inbox
            </p>
            <p className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success-foreground" /> Clear follow-up and
              booking status
            </p>
            <p className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" /> Approval stays with your business
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Built for Australian service businesses.</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="panel w-full max-w-sm overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                G
              </div>
              <div>
                <h1 className="text-base font-semibold">BookedSecure</h1>
                <p className="text-xs text-muted-foreground">Team access only</p>
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4 p-5">
            {mode === "signup" && (
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Your name</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
              />
            </label>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="w-full border-t border-border px-5 py-4 text-center text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {mode === "signin"
              ? "First time? Create your team account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </section>
    </div>
  );
}
