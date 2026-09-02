// Server-only abuse protection for anonymous public forms.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PROVIDER = "public_form";

export async function hashClientId(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`glocast:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Records an attempt from `clientId` (hashed) and returns false when the caller
 * has exceeded the short-window or hourly budget. Never throws on storage
 * errors — abuse protection must not take the public form offline.
 */
export async function allowPublicFormAttempt(
  clientId: string,
  options: { perMinute?: number; perHour?: number } = {},
): Promise<boolean> {
  const perMinute = options.perMinute ?? 3;
  const perHour = options.perHour ?? 10;
  const key = await hashClientId(clientId);

  try {
    await supabaseAdmin.from("webhook_events").insert({
      provider: PROVIDER,
      event_id: `${key}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      event_type: "quote_form_attempt",
      payload: { client: key } as never,
    });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("webhook_events")
      .select("created_at")
      .eq("provider", PROVIDER)
      .like("event_id", `${key}:%`)
      .gte("created_at", hourAgo)
      // Must exceed the largest hourly budget, otherwise the cap is never seen.
      .limit(400);

    const rows = data ?? [];
    if (rows.length > perHour) return false;
    const minuteAgo = Date.now() - 60 * 1000;
    const recent = rows.filter((row) => new Date(row.created_at).getTime() > minuteAgo);
    return recent.length <= perMinute;
  } catch {
    return true;
  }
}
