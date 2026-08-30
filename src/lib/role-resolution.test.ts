import { describe, expect, it } from "vitest";
import { requireAppContext, requireOwner } from "./app-context.server";

const BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_USER = "d935abe2-c2f0-42c4-9c8d-ab2ed459e08a";
const ADMIN_USER = "331fce0c-9a36-42ac-a48b-6d639d871274";

/**
 * Minimal stand-in for the caller's RLS-scoped client. Mirrors the two reads
 * requireAppContext performs: the caller's profile, then their role rows.
 */
function fakeSupabase(profile: Record<string, unknown> | null, roles: string[]) {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => ({ data: roles.map((role) => ({ role })), error: null }),
        }),
      };
    },
  } as never;
}

const glocastProfile = {
  id: OWNER_USER,
  business_id: BUSINESS_ID,
  name: "Glocast",
  email: "info@glocast.com.au",
  active: true,
};

describe("Glocast role resolution after the additive owner grant", () => {
  it("resolves info@glocast.com.au to owner when it holds owner + staff", async () => {
    const ctx = await requireAppContext(fakeSupabase(glocastProfile, ["staff", "owner"]), OWNER_USER);
    expect(ctx.role).toBe("owner");
    expect(ctx.businessId).toBe(BUSINESS_ID);
    expect(() => requireOwner(ctx)).not.toThrow();
  });

  it("keeps the existing platform admin resolving to platform_admin", async () => {
    const ctx = await requireAppContext(
      fakeSupabase({ ...glocastProfile, id: ADMIN_USER, email: "abshir95m@gmail.com" }, [
        "staff",
        "platform_admin",
      ]),
      ADMIN_USER,
    );
    expect(ctx.role).toBe("platform_admin");
    expect(() => requireOwner(ctx)).not.toThrow();
  });

  it("still treats a staff-only member as staff and blocks owner-gated settings", async () => {
    const ctx = await requireAppContext(fakeSupabase(glocastProfile, ["staff"]), OWNER_USER);
    expect(ctx.role).toBe("staff");
    expect(() => requireOwner(ctx)).toThrow(/owner/i);
  });

  it("rejects a deactivated or unassigned profile regardless of role", async () => {
    await expect(
      requireAppContext(fakeSupabase({ ...glocastProfile, active: false }, ["owner"]), OWNER_USER),
    ).rejects.toThrow(/deactivated/i);
    await expect(
      requireAppContext(fakeSupabase({ ...glocastProfile, business_id: null }, ["owner"]), OWNER_USER),
    ).rejects.toThrow(/not linked/i);
  });
});
