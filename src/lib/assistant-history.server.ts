import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AssistantThread = {
  id: string;
  title: string;
  isDefault: boolean;
  updatedAt: string;
};

export type AssistantTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposals: unknown[];
  done: string | null;
  createdAt: string;
};

function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ");
  return compact.length > 46 ? `${compact.slice(0, 43)}…` : compact;
}

export async function assertAssistantThread(businessId: string, threadId: string) {
  const { data, error } = await supabaseAdmin
    .from("assistant_threads")
    .select("id, title, is_default, updated_at")
    .eq("business_id", businessId)
    .eq("id", threadId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conversation not found.");
  return data;
}

export async function getOrCreateDefaultAssistantThread(input: {
  businessId: string;
  userId: string;
}): Promise<AssistantThread> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("assistant_threads")
    .select("id, title, is_default, updated_at")
    .eq("business_id", input.businessId)
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const row = existing ?? (
    await supabaseAdmin
      .from("assistant_threads")
      .insert({ business_id: input.businessId, created_by: input.userId, is_default: true })
      .select("id, title, is_default, updated_at")
      .single()
  ).data;
  if (!row) throw new Error("Could not open your ongoing conversation.");
  return { id: row.id, title: row.title, isDefault: row.is_default, updatedAt: row.updated_at };
}

export async function listAssistantThreads(businessId: string): Promise<AssistantThread[]> {
  const { data, error } = await supabaseAdmin
    .from("assistant_threads")
    .select("id, title, is_default, updated_at")
    .eq("business_id", businessId)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
  }));
}

export async function createAssistantThread(input: { businessId: string; userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("assistant_threads")
    .insert({ business_id: input.businessId, created_by: input.userId, title: "New conversation" })
    .select("id, title, is_default, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the conversation.");
  return { id: data.id, title: data.title, isDefault: data.is_default, updatedAt: data.updated_at };
}

export async function loadAssistantThread(input: { businessId: string; threadId: string }) {
  const thread = await assertAssistantThread(input.businessId, input.threadId);
  const { data, error } = await supabaseAdmin
    .from("assistant_messages")
    .select("id, role, parts, proposals, done, created_at")
    .eq("business_id", input.businessId)
    .eq("thread_id", input.threadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return {
    thread: { id: thread.id, title: thread.title, isDefault: thread.is_default, updatedAt: thread.updated_at },
    messages: (data ?? []).map((row) => {
      const parts = Array.isArray(row.parts) ? row.parts : [];
      const textPart = parts.find(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && "type" in part && part["type"] === "text" && "text" in part,
      );
      return {
        id: row.id,
        role: row.role === "user" ? "user" as const : "assistant" as const,
        text: textPart?.text ?? "",
        proposals: Array.isArray(row.proposals) ? row.proposals : [],
        done: row.done,
        createdAt: row.created_at,
      } satisfies AssistantTurn;
    }),
  };
}

export async function persistOwnerExchange(input: {
  businessId: string;
  threadId: string;
  question: string;
  answer: string;
  proposals: unknown[];
}) {
  const thread = await assertAssistantThread(input.businessId, input.threadId);
  const { count } = await supabaseAdmin
    .from("assistant_messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId)
    .eq("thread_id", input.threadId);
  const userCreatedAt = new Date().toISOString();
  const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
  const { data: inserted, error } = await supabaseAdmin.from("assistant_messages").insert([
    {
      business_id: input.businessId,
      thread_id: input.threadId,
      role: "user",
      parts: [{ type: "text", text: input.question }] as Json,
      created_at: userCreatedAt,
    },
    {
      business_id: input.businessId,
      thread_id: input.threadId,
      role: "assistant",
      parts: [{ type: "text", text: input.answer }] as Json,
      proposals: input.proposals as Json,
      created_at: assistantCreatedAt,
    },
  ]).select("id, role");
  if (error) throw new Error(error.message);
  if (!thread.is_default && (count ?? 0) === 0) {
    await supabaseAdmin
      .from("assistant_threads")
      .update({ title: titleFromQuestion(input.question) })
      .eq("business_id", input.businessId)
      .eq("id", input.threadId);
  } else {
    await supabaseAdmin
      .from("assistant_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("business_id", input.businessId)
      .eq("id", input.threadId);
  }
  return {
    userMessageId: inserted?.find((row) => row.role === "user")?.id ?? null,
    assistantMessageId: inserted?.find((row) => row.role === "assistant")?.id ?? null,
  };
}

export async function completeAssistantProposal(input: {
  businessId: string;
  messageId: string;
  done: string;
}) {
  const { error } = await supabaseAdmin
    .from("assistant_messages")
    .update({ done: input.done, proposals: [] })
    .eq("business_id", input.businessId)
    .eq("id", input.messageId)
    .eq("role", "assistant");
  if (error) throw new Error(error.message);
}

export async function archiveAssistantThread(input: { businessId: string; threadId: string }) {
  const thread = await assertAssistantThread(input.businessId, input.threadId);
  if (thread.is_default) throw new Error("The ongoing conversation cannot be deleted.");
  const { error } = await supabaseAdmin
    .from("assistant_threads")
    .update({ archived_at: new Date().toISOString() })
    .eq("business_id", input.businessId)
    .eq("id", input.threadId);
  if (error) throw new Error(error.message);
}