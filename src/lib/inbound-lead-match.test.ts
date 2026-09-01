import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";
import { isOptOutMessage } from "@/lib/domain";

// Pure lookup test: the admin client is stubbed so importing the engine never
// opens a connection, and the fake client is passed in explicitly.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { findActiveLeadByMobile } = await import("@/lib/lead-engine.server");

const BUSINESS_A = "biz-a";
const BUSINESS_B = "biz-b";
const MOBILE = "+61447852565";

function db(): FakeDb {
  return {
    leads: [
      {
        id: "deleted-newest",
        business_id: BUSINESS_A,
        mobile_number: MOBILE,
        created_at: "2026-09-01T05:00:00Z",
        deleted_at: "2026-09-01T06:00:00Z",
        status: "new",
      },
      {
        id: "active-older",
        business_id: BUSINESS_A,
        mobile_number: MOBILE,
        created_at: "2026-08-20T05:00:00Z",
        deleted_at: null,
        status: "new",
      },
      {
        id: "active-oldest",
        business_id: BUSINESS_A,
        mobile_number: MOBILE,
        created_at: "2026-07-01T05:00:00Z",
        deleted_at: null,
        status: "new",
      },
      {
        id: "other-tenant",
        business_id: BUSINESS_B,
        mobile_number: MOBILE,
        created_at: "2026-09-01T07:00:00Z",
        deleted_at: null,
        status: "new",
      },
    ],
  };
}

describe("inbound lead matching", () => {
  it("never attaches a reply to a soft-deleted lead", async () => {
    const { client } = createFakeSupabase(db());
    const { data } = await findActiveLeadByMobile(client, BUSINESS_A, MOBILE);
    expect(data?.id).not.toBe("deleted-newest");
  });

  it("attaches to the most recent active lead", async () => {
    const { client } = createFakeSupabase(db());
    const { data } = await findActiveLeadByMobile(client, BUSINESS_A, MOBILE);
    expect(data?.id).toBe("active-older");
  });

  it("preserves tenant isolation", async () => {
    const { client } = createFakeSupabase(db());
    const a = await findActiveLeadByMobile(client, BUSINESS_A, MOBILE);
    const b = await findActiveLeadByMobile(client, BUSINESS_B, MOBILE);
    expect(a.data?.business_id).toBe(BUSINESS_A);
    expect(b.data?.id).toBe("other-tenant");
  });

  it("returns no lead when every match is soft-deleted", async () => {
    const data = db();
    data.leads = data.leads.map((row) =>
      row.business_id === BUSINESS_A ? { ...row, deleted_at: "2026-09-01T06:00:00Z" } : row,
    );
    const { client } = createFakeSupabase(data);
    const result = await findActiveLeadByMobile(client, BUSINESS_A, MOBILE);
    expect(result.data).toBeNull();
  });

  it("performs no writes while matching", async () => {
    const { client, log } = createFakeSupabase(db());
    await findActiveLeadByMobile(client, BUSINESS_A, MOBILE);
    expect(log.filter((entry) => entry.op !== "select")).toEqual([]);
  });

  it("leaves STOP detection unchanged", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("stop please")).toBe(true);
    expect(isOptOutMessage("Yes please, SUV in Newtown")).toBe(false);
  });
});
