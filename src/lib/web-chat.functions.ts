import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

function clientIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Opens a public AI quote conversation for an AI-mode tenant. */
export const startQuoteConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ slug: z.string().min(1).max(60), company: z.string().max(200).optional().nullable() }).parse(input),
  )
  .handler(async ({ data }) => {
    // Honeypot: bots get an ordinary-looking refusal with no signal.
    if (data.company && data.company.trim().length > 0) return { ok: false as const, error: "Unavailable." };

    const { allowPublicFormAttempt } = await import("@/lib/rate-limit.server");
    if (!(await allowPublicFormAttempt(clientIp()))) {
      return { ok: false as const, error: "Too many requests from this device. Please try again shortly." };
    }

    const { startWebChat } = await import("@/lib/web-chat.server");
    try {
      const state = await startWebChat(data.slug);
      if (!state) return { ok: false as const, error: "This conversation is not available." };
      return { ok: true as const, state };
    } catch (error) {
      console.error("[web-chat] start failed", error);
      return { ok: false as const, error: "We couldn't start the conversation. Please try again shortly." };
    }
  });

/** Records one customer answer and returns the next assistant turn. */
export const replyQuoteConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(1).max(60),
        conversation_id: z.string().uuid(),
        answer: z.string().min(1).max(500),
        form_url: z.string().max(300).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { allowPublicFormAttempt } = await import("@/lib/rate-limit.server");
    if (!(await allowPublicFormAttempt(`chat:${clientIp()}`))) {
      return { ok: false as const, error: "Too many messages from this device. Please try again shortly." };
    }

    const { replyToWebChat } = await import("@/lib/web-chat.server");
    try {
      const state = await replyToWebChat({
        slug: data.slug,
        conversationId: data.conversation_id,
        answer: data.answer,
        formUrl: data.form_url ?? null,
      });
      if (!state) return { ok: false as const, error: "This conversation is no longer available." };
      return { ok: true as const, state };
    } catch (error) {
      console.error("[web-chat] reply failed", error);
      return { ok: false as const, error: "We couldn't send that. Please try again shortly." };
    }
  });
