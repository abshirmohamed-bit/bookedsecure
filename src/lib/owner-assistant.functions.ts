import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_ASSISTANT_MAX_QUESTION, normaliseOwnerQuestion } from "@/lib/owner-assistant";

const QuestionSchema = z.object({
  question: z.string().max(OWNER_ASSISTANT_MAX_QUESTION * 2),
});

/** Read-only snapshot of the caller's own business. */
export const getOwnerSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { loadOwnerSnapshot } = await import("@/lib/owner-assistant.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return loadOwnerSnapshot(app.businessId);
  });

/** Answers one owner question from that tenant's own records. Sends nothing. */
export const askOwnerAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => QuestionSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { answerOwnerQuestion } = await import("@/lib/owner-assistant.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return answerOwnerQuestion({
      businessId: app.businessId,
      question: normaliseOwnerQuestion(data.question),
    });
  });
