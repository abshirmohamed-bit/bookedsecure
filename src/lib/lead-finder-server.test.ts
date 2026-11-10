import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: [] as { table: string; op: string; value: unknown }[], searches: 0 }));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "lead_finder_searches" && op === "insert") return { data: { id: "search-1" }, error: null };
      if (table === "lead_finder_searches" && op === "select") return { data: [], error: null, count: state.searches };
      return { data: null, error: null };
    };
    for (const m of ["select", "eq", "neq", "gte", "limit", "order", "in", "is"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = (value: unknown) => { op = m; state.writes.push({ table, op, value }); return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown) => resolve(result());
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

process.env["LOVABLE_API_KEY"] = "lovable";
process.env["FIRECRAWL_API_KEY"] = "firecrawl";
delete process.env["GOOGLE_PLACES_API_KEY"];
delete process.env["ZEROBOUNCE_API_KEY"];

import { runLeadSearch } from "./lead-finder.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function fakeInternet(url: string, init?: RequestInit): Response {
  if (url.includes("/firecrawl/v2/search")) {
    return Response.json({ success: true, data: { web: [
      { url: "https://www.auburnlogistics.com.au/", title: "Auburn Logistics | Warehousing Sydney" },
      { url: "https://www.yellowpages.com.au/nsw/auburn/warehouses", title: "Warehouses in Auburn" },
    ] } });
  }
  if (url.includes("/firecrawl/v2/scrape")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { url: string };
    expect(body.url).toBe("https://auburnlogistics.com.au");
    return Response.json({ data: {
      markdown: "Auburn Logistics. 120 staff across two warehouses. Email info@auburnlogistics.com.au",
      json: { businessName: "Auburn Logistics Pty Ltd", suburb: "Auburn", phone: "02 9000 1111", summary: "Warehousing and freight in Auburn.", fit: "good", fitReason: "Large staffed warehouse.", emails: ["info@auburnlogistics.com.au"] },
    } });
  }
  if (url.includes("nominatim")) return Response.json([{ boundingbox: ["-33.88", "-33.83", "151.01", "151.04"] }]);
  if (url.includes("overpass") || url.includes("maps.mail.ru")) {
    return Response.json({ elements: [
      { type: "node", id: 7, tags: { name: "World Gym Auburn", leisure: "fitness_centre", "addr:suburb": "Auburn" } },
      { type: "node", id: 8, tags: { name: "Chemist Warehouse", shop: "chemist" } },
    ] });
  }
  if (url.includes("cloudflare-dns.com")) return Response.json({ Answer: [{ data: "10 mx.auburnlogistics.com.au." }] });
  return new Response("not found", { status: 404 });
}

beforeEach(() => { state.writes = []; state.searches = 0; });

describe("Lead finder search (no Google needed)", () => {
  it("finds businesses on the web and OpenStreetMap, reads the website and keeps its email", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => fakeInternet(String(url), init));
    const r = await runLeadSearch({ businessId: BIZ, userId: USER, what: "warehouses and gyms", where: "Auburn NSW", criteria: "50+ staff", limit: 10, fetcher: fetcher as unknown as typeof fetch });
    expect(r).toEqual({ searchId: "search-1", found: 2, withEmail: 1 });
    const saved = state.writes.find((w) => w.table === "lead_finder_prospects" && w.op === "upsert")?.value as Array<Record<string, unknown>>;
    expect(saved.map((p) => p["name"])).toEqual(["Auburn Logistics Pty Ltd", "World Gym Auburn"]);
    expect(saved[0]).toMatchObject({ place_id: "web:auburnlogistics.com.au", email: "info@auburnlogistics.com.au", email_status: "unverified", fit: "good", suburb: "Auburn", phone: "02 9000 1111" });
    expect(saved[1]).toMatchObject({ place_id: "osm:node/7", email: null, email_status: "none", fit: "unknown" });
    // No Google call was made.
    expect(fetcher.mock.calls.some(([u]) => String(u).includes("places.googleapis.com"))).toBe(false);
  });

  it("stops at the monthly limit", async () => {
    state.searches = 20;
    await expect(runLeadSearch({ businessId: BIZ, userId: USER, what: "gyms", where: "Auburn" })).rejects.toThrow(/20 searches/);
  });
});
