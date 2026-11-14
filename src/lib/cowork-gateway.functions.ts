import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GATEWAY_CHANNELS } from "@/lib/cowork-gateway";

/** Each person links their own phone, email and Telegram; nobody sees anyone else's. */
async function member(context: { supabase: unknown; userId: string }) {
  const { requireWriteContext } = await import("@/lib/app-context.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return requireWriteContext(context.supabase as any, context.userId);
}

export const getCoworkGateways = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { listGateways } = await import("@/lib/cowork-gateway.server");
    return { ...(await listGateways(app.businessId, app.userId)), loginEmail: app.email };
  });

export const linkCoworkGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.discriminatedUnion("channel", [
    z.object({ channel: z.literal("sms"), mobile: z.string().min(8).max(20) }),
    z.object({ channel: z.literal("email"), address: z.string().min(5).max(200) }),
    z.object({ channel: z.literal("telegram") }),
  ]).parse(input))
  .handler(async ({ data, context }) => {
    const app = await member(context);
    const server = await import("@/lib/cowork-gateway.server");
    if (data.channel === "sms") return { ...(await server.startSmsLink({ businessId: app.businessId, userId: app.userId, mobile: data.mobile })), url: null };
    if (data.channel === "email") return { ...(await server.startEmailLink({ businessId: app.businessId, userId: app.userId, address: data.address, loginEmail: app.email })), url: null };
    return { ok: true as const, ...(await server.startTelegramLink({ businessId: app.businessId, userId: app.userId })) };
  });

export const confirmCoworkGatewayCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ channel: z.enum(["sms", "email"]), code: z.string().regex(/^\s*\d{6}\s*$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const app = await member(context);
    const { confirmGatewayCode } = await import("@/lib/cowork-gateway.server");
    return confirmGatewayCode({ businessId: app.businessId, userId: app.userId, channel: data.channel, code: data.code });
  });

export const updateCoworkGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ channel: z.enum(GATEWAY_CHANNELS), enabled: z.boolean().optional(), remove: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const server = await import("@/lib/cowork-gateway.server");
    if (data.remove) await server.removeGateway({ businessId: app.businessId, userId: app.userId, channel: data.channel });
    else if (data.enabled !== undefined) await server.setGatewayEnabled({ businessId: app.businessId, userId: app.userId, channel: data.channel, enabled: data.enabled });
    return { ok: true };
  });
