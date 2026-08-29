import { describe, expect, it } from "vitest";
import { requirePlatformAdmin } from "./pilot.server";

// The trusted reassignment path (adminReassignProfile) verifies the caller's
// platform_admin role with their own RLS-scoped client before the service-role
// client is allowed to touch profiles.business_id / profiles.active.
function fakeSupabase(role: string | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never;
}

describe("trusted profile reassignment gate", () => {
  it("allows a platform admin", async () => {
    await expect(requirePlatformAdmin(fakeSupabase("platform_admin"), "admin-1")).resolves.toBe(
      "admin-1",
    );
  });

  it("rejects a tenant user with no platform_admin role", async () => {
    await expect(requirePlatformAdmin(fakeSupabase(null), "tenant-a-user")).rejects.toThrow(
      /platform administrators/i,
    );
  });
});
