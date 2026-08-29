import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures the exact query built for the webhook-supplied number so we can
// prove the filter cannot be altered by hostile punctuation.
const calls: {
  or: string[];
  in: { column: string; values: string[] }[];
  eq: { column: string; value: unknown }[];
  notNull: string[];
} = { or: [], in: [], eq: [], notNull: [] };

let row: Record<string, unknown> | null = null;

vi.mock("@/integrations/supabase/client.server", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    or: (filter: string) => {
      calls.or.push(filter);
      return chain;
    },
    in: (column: string, values: string[]) => {
      calls.in.push({ column, values });
      return chain;
    },
    eq: (column: string, value: unknown) => {
      calls.eq.push({ column, value });
      return chain;
    },
    not: (column: string) => {
      calls.notNull.push(column);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  });
  return { supabaseAdmin: { from: () => chain } };
});

const { findSenderByNumber } = await import("./lead-engine.server");

beforeEach(() => {
  calls.or = [];
  calls.in = [];
  calls.eq = [];
  calls.notNull = [];
  row = null;
});

describe("findSenderByNumber uses a parameterised number filter", () => {
  it("queries the normalised and raw number as a value list, never a filter string", async () => {
    await findSenderByNumber("0468 045 220");
    expect(calls.or).toHaveLength(0);
    expect(calls.in).toEqual([
      { column: "phone_number", values: ["+61468045220", "0468 045 220"] },
    ]);
  });

  it("keeps the active and assigned-business gates", async () => {
    await findSenderByNumber("+61468045220");
    expect(calls.eq).toEqual([{ column: "active", value: true }]);
    expect(calls.notNull).toContain("business_id");
  });

  it("cannot be broadened by punctuation, commas, parentheses or operators", async () => {
    const hostile = '+61468045220,phone_number.neq.x),or=(active.eq.false';
    await findSenderByNumber(hostile);
    // The hostile text stays a single value in the list; no filter string is built.
    expect(calls.or).toHaveLength(0);
    expect(calls.in[0]?.column).toBe("phone_number");
    expect(calls.in[0]?.values).toContain(hostile);
    for (const value of calls.in[0]?.values ?? []) {
      expect(typeof value).toBe("string");
    }
    // Gates unchanged despite the injection attempt.
    expect(calls.eq).toEqual([{ column: "active", value: true }]);
    expect(calls.notNull).toContain("business_id");
  });

  it("does not match unassigned or inactive inventory (no row returned)", async () => {
    row = null;
    await expect(findSenderByNumber("+61400000000")).resolves.toBeNull();
  });

  it("still resolves a matching active sender", async () => {
    row = {
      id: "sender-1",
      business_id: "biz-1",
      phone_number: "+61468045220",
      provider: "telnyx",
      credential_mode: "platform",
      subaccount_sid: null,
      credential_secret_name: null,
      messaging_profile_id: "mp_1",
    };
    const sender = await findSenderByNumber("+61468045220");
    expect(sender?.businessId).toBe("biz-1");
  });
});
