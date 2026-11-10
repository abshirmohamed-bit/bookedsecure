import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the Supabase query builder: every chain resolves to the
// result queued for that table, and inserts/updates are recorded.
const state = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  recent: [] as unknown[],
  writes: [] as { table: string; op: string; value: unknown }[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "linkedin_accounts") return { data: state.account, error: null };
      if (table === "linkedin_posts" && op === "insert") return { data: { id: "post-1" }, error: null };
      if (table === "linkedin_posts") return { data: state.recent, error: null };
      return { data: null, error: null };
    };
    for (const m of ["select", "eq", "neq", "gte", "limit", "order"]) chain[m] = () => chain;
    chain["insert"] = (value: unknown) => { op = "insert"; state.writes.push({ table, op, value }); return chain; };
    chain["update"] = (value: unknown) => { op = "update"; state.writes.push({ table, op, value }); return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown) => resolve(result());
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

process.env["LINKEDIN_CLIENT_ID"] = "client";
process.env["LINKEDIN_CLIENT_SECRET"] = "secret";
process.env["TENANT_AI_ENCRYPTION_SECRET"] = "test-secret-for-linkedin";

import { encryptMetaToken } from "./meta-oauth.server";
import { linkedInActions, publishLinkedInPost, signLinkedInState, startLinkedInUpload, uploadLinkedInPart, finishLinkedInVideoUpload, signUploadTicket, verifyUploadTicket, verifyLinkedInState } from "./linkedin.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.writes = [];
  state.recent = [];
  state.account = {
    business_id: BIZ,
    member_urn: "urn:li:person:abc",
    member_name: "Sam Owner",
    token_ciphertext: encryptMetaToken("token-123", `linkedin:${BIZ}`),
    token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    scopes: ["w_member_social", "w_organization_social"],
    organizations: [{ id: "42", name: "Glocast" }],
    default_author_urn: "urn:li:organization:42",
    connected_at: new Date().toISOString(),
  };
});

describe("LinkedIn sign-in state", () => {
  it("round-trips and rejects tampering or expiry", () => {
    const s = signLinkedInState({ businessId: BIZ, userId: USER });
    expect(verifyLinkedInState(s)).toEqual({ businessId: BIZ, userId: USER, pages: false });
    expect(verifyLinkedInState(signLinkedInState({ businessId: BIZ, userId: USER, pages: true }))?.pages).toBe(true);
    expect(verifyLinkedInState(`${s}x`)).toBeNull();
    expect(verifyLinkedInState(s, Date.now() + 16 * 60_000)).toBeNull();
  });
});

describe("posting needs the owner's confirmation", () => {
  it("previews as the default Page and posts only with the matching code", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:7" } }));
    vi.stubGlobal("fetch", fetcher);
    const preview = await linkedInActions.preview(BIZ, { text: "Fresh detail done (Ranger) #detailing" });
    expect(preview.summary).toMatchObject({ postsAs: "Glocast", kind: "Company Page" });
    await expect(linkedInActions.publish(BIZ, USER, { text: "Something else", confirmationCode: preview.confirmationCode, source: "mcp" })).rejects.toThrow(/Preview it again/);
    expect(fetcher).not.toHaveBeenCalled();

    const done = await linkedInActions.publish(BIZ, USER, { text: "Fresh detail done (Ranger) #detailing", confirmationCode: preview.confirmationCode, source: "mcp" });
    expect(done).toMatchObject({ published: true, url: "https://www.linkedin.com/feed/update/urn:li:share:7/", authorName: "Glocast" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-123", "X-Restli-Protocol-Version": "2.0.0" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ author: "urn:li:organization:42", commentary: "Fresh detail done \\(Ranger\\) #detailing" });
    vi.unstubAllGlobals();
  });

  it("records a failure with a plain reason", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(publishLinkedInPost({ businessId: BIZ, userId: USER, text: "Hi", source: "app", fetcher })).rejects.toThrow(/Reconnect LinkedIn/);
    expect(state.writes.some((w) => w.op === "update" && (w.value as { status?: string }).status === "failed")).toBe(true);
  });

  it("doesn't post the same text twice in two minutes", async () => {
    state.recent = [{ id: "old", post_urn: "urn:li:share:1" }];
    const fetcher = vi.fn();
    await expect(publishLinkedInPost({ businessId: BIZ, userId: USER, text: "Hi", source: "app", fetcher })).resolves.toMatchObject({ duplicate: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts as a Company Page with the Pages app's token when that app is connected", async () => {
    state.account = { ...state.account!, pages_token_ciphertext: encryptMetaToken("pages-token-9", `linkedin-pages:${BIZ}`), pages_token_expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:8" } }));
    await publishLinkedInPost({ businessId: BIZ, userId: USER, text: "Page post", authorUrn: "urn:li:organization:42", source: "app", fetcher });
    expect((fetcher.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer pages-token-9" });
    await publishLinkedInPost({ businessId: BIZ, userId: USER, text: "Profile post", authorUrn: "urn:li:person:abc", source: "app", fetcher });
    expect((fetcher.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-123" });
  });

  it("refuses an author the business can't post as", async () => {
    await expect(linkedInActions.preview(BIZ, { text: "Hi", authorUrn: "urn:li:organization:999" })).rejects.toThrow(/can't post as/);
  });
});


describe("attaching images, videos and documents", () => {
  it("starts an upload, sends each piece with the business token, and finishes a video", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { video: "urn:li:video:V1", uploadToken: "tok", uploadInstructions: [
        { uploadUrl: "https://www.linkedin.com/dms-uploads/p1", firstByte: 0, lastByte: 4194303 },
        { uploadUrl: "https://www.linkedin.com/dms-uploads/p2", firstByte: 4194304, lastByte: 5000000 },
      ] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: "e1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const plan = await startLinkedInUpload({ businessId: BIZ, userId: USER, kind: "video", fileSize: 5_000_001, authorUrn: "urn:li:person:abc", fetcher });
    expect(plan).toMatchObject({ urn: "urn:li:video:V1", uploadToken: "tok" });
    expect(plan.parts).toHaveLength(2);
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ initializeUploadRequest: { owner: "urn:li:person:abc", fileSizeBytes: 5_000_001 } });

    const part = await uploadLinkedInPart({ ticket: plan.parts[0]!.ticket, userId: USER, bytes: new ArrayBuffer(8), fetcher });
    expect(part.etag).toBe("e1");
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe("https://www.linkedin.com/dms-uploads/p1");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-123" });

    await finishLinkedInVideoUpload({ businessId: BIZ, urn: "urn:li:video:V1", uploadToken: "tok", etags: ["e1", "e2"], authorUrn: "urn:li:person:abc", fetcher });
    expect(JSON.parse((fetcher.mock.calls[2]![1] as RequestInit).body as string)).toEqual({ finalizeUploadRequest: { video: "urn:li:video:V1", uploadToken: "tok", uploadedPartIds: ["e1", "e2"] } });
  });

  it("won't let a ticket be used by someone else, after it expires, or for another address", async () => {
    const ticket = signUploadTicket({ businessId: BIZ, userId: USER, url: "https://www.linkedin.com/dms-uploads/x", authorUrn: "urn:li:person:abc" });
    await expect(uploadLinkedInPart({ ticket, userId: "33333333-3333-4333-8333-333333333333", bytes: new ArrayBuffer(1), fetcher: vi.fn() })).rejects.toThrow(/expired/);
    expect(verifyUploadTicket(ticket, Date.now() + 3 * 60 * 60_000)).toBeNull();
    expect(verifyUploadTicket(signUploadTicket({ businessId: BIZ, userId: USER, url: "https://evil.example/x", authorUrn: "urn:li:person:abc" }))).toBeNull();
  });

  it("refuses files over LinkedIn's limits before asking LinkedIn", async () => {
    const fetcher = vi.fn();
    await expect(startLinkedInUpload({ businessId: BIZ, userId: USER, kind: "image", fileSize: 50 * 1024 * 1024, fetcher })).rejects.toThrow(/too big/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts with the attached images", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }));
    await publishLinkedInPost({ businessId: BIZ, userId: USER, text: "New van!", authorUrn: "urn:li:person:abc", source: "app", media: { kind: "image", items: [{ urn: "urn:li:image:A" }, { urn: "urn:li:image:B" }] }, fetcher });
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ content: { multiImage: { images: [{ id: "urn:li:image:A" }, { id: "urn:li:image:B" }] } } });
  });
});
