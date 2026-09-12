/**
 * Team-member administration shared by the Team access page and the assistant.
 *
 * Every action is closed over the caller's business: a profile outside that
 * business is reported as "not on your team", never touched. Owners cannot
 * remove or delete themselves, and other owners are never removed by staff.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Actor = { businessId: string; userId: string; role: "owner" | "staff" | "platform_admin"; via: "assistant" | "settings" };

type MemberResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

function canManage(actor: Actor): string | null {
  return actor.role === "owner" || actor.role === "platform_admin"
    ? null
    : "Only the business owner can change team access.";
}

async function findMember(actor: Actor, profileId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, active")
    .eq("id", profileId)
    .eq("business_id", actor.businessId)
    .maybeSingle();
  return data;
}

async function isOwner(profileId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", profileId)
    .eq("role", "owner")
    .limit(1);
  return (data ?? []).length > 0;
}

async function audit(actor: Actor, eventType: string, profileId: string, metadata: Record<string, unknown>) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: actor.businessId,
    user_id: actor.userId,
    event_type: eventType,
    entity_type: "profile",
    entity_id: profileId,
    metadata: { ...metadata, via: actor.via } as never,
  });
}

/** Switches a team member's access on or off. */
export async function setTeamMemberAccess(
  actor: Actor,
  profileId: string,
  active: boolean,
): Promise<MemberResult> {
  const denied = canManage(actor);
  if (denied) return { ok: false, error: denied };
  if (profileId === actor.userId) return { ok: false, error: "You cannot change your own access." };
  const member = await findMember(actor, profileId);
  if (!member) return { ok: false, error: "That person is not on this business's team." };
  if (!active && actor.role !== "platform_admin" && (await isOwner(profileId))) {
    return { ok: false, error: "Another owner's access cannot be removed from here." };
  }
  if (active && !member.active) {
    const { assertTeamSeatAvailable } = await import("@/lib/subscription.server");
    try {
      await assertTeamSeatAvailable(actor.businessId);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ active })
    .eq("id", profileId)
    .eq("business_id", actor.businessId);
  if (error) return { ok: false, error: error.message };
  await audit(actor, active ? "team_member_reactivated" : "team_member_deactivated", profileId, {});
  return { ok: true, name: member.name ?? member.email ?? "that team member" };
}

/**
 * Permanently deletes a team member: their sign-in, profile and role. Leads,
 * bookings and messages belong to the business and are untouched.
 */
export async function deleteTeamMember(actor: Actor, profileId: string): Promise<MemberResult> {
  const denied = canManage(actor);
  if (denied) return { ok: false, error: denied };
  if (profileId === actor.userId) return { ok: false, error: "You cannot delete your own account from here." };
  const member = await findMember(actor, profileId);
  if (!member) return { ok: false, error: "That person is not on this business's team." };
  if (actor.role !== "platform_admin" && (await isOwner(profileId))) {
    return { ok: false, error: "Another owner cannot be deleted from here." };
  }
  const name = member.name ?? member.email ?? "that team member";

  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(profileId);
  // A sign-in that no longer exists is fine: the profile is still cleaned up.
  if (authError && authError.status !== 404) {
    return { ok: false, error: `Could not remove that sign-in: ${authError.message}` };
  }
  await supabaseAdmin.from("user_roles").delete().eq("user_id", profileId);
  const { error } = await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", profileId)
    .eq("business_id", actor.businessId);
  if (error) return { ok: false, error: error.message };

  await audit(actor, "team_member_deleted", profileId, { name, email: member.email });
  return { ok: true, name };
}
