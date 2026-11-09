import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildFeed } from "./notification-feed";
import { htmlToText, parseAddress, recipientIdFromAddresses, replyAddressFor, replyToHeader, stripQuotedReply, verifyResendWebhook } from "./email-inbound";

const id = "0d74c6e9-43dd-4463-90d7-1d1476a29ef3";

describe("reply addresses", () => {
  it("round-trips a recipient id through the reply address", () => {
    const address = replyAddressFor(id);
    expect(address).toBe(`reply+${id}@reply.bookedsecure.com`);
    expect(recipientIdFromAddresses(["someone@else.com", `Glocast <${address.toUpperCase()}>`])).toBe(id);
    expect(recipientIdFromAddresses(["reply+not-a-uuid@reply.bookedsecure.com", "reply+" + id + "@evil.com"])).toBeNull();
  });

  it("names the reply address after the business", () => {
    expect(replyAddressFor(id, "Glocast Mobile Auto Detailing")).toBe(`glocast-mobile-auto+${id}@reply.bookedsecure.com`);
    // The part before @ must stay within the 64-character limit, whatever the name.
    for (const name of ["Glocast Mobile Auto Detailing", "Supercalifragilisticexpialidocious Cleaning Services Pty Ltd", "A", ""]) {
      expect(replyAddressFor(id, name).split("@")[0]!.length).toBeLessThanOrEqual(64);
    }
    // Resend rejects quoted names, so the name is plain: Name <email>.
    expect(replyToHeader(id, `Jo's "Best" Cleaning, Pty`)).toBe(`Jo's Best Cleaning Pty <jo-s-best-cleaning-pty+${id}@reply.bookedsecure.com>`);
    expect(replyToHeader(id, "Glocast Mobile Auto Detailing")).toMatch(/^Glocast Mobile Auto Detailing <glocast-mobile-auto\+[0-9a-f-]+@reply\.bookedsecure\.com>$/);
    expect(recipientIdFromAddresses([`Glocast <glocast-mobile-auto+${id}@reply.bookedsecure.com>`])).toBe(id);
    expect(recipientIdFromAddresses([`reply+${id}@reply.bookedsecure.com`])).toBe(id);
  });

  it("reads names and addresses", () => {
    expect(parseAddress('"Jess Smith" <Jess@Example.com>')).toEqual({ name: "Jess Smith", email: "jess@example.com" });
    expect(parseAddress("jess@example.com")).toEqual({ name: null, email: "jess@example.com" });
  });
});

describe("what the customer wrote", () => {
  it("drops the quoted campaign email and phone signatures", () => {
    const text = "Yes please, Saturday works!\n\nSent from my iPhone\n\nOn Mon, 10 Nov 2026 at 9:00 am Glocast <campaigns@bookedsecure.com> wrote:\n> Hi there,\n> We have openings";
    expect(stripQuotedReply(text)).toBe("Yes please, Saturday works!");
    expect(stripQuotedReply("Thanks\n> quoted\nSee you")).toBe("Thanks\nSee you");
  });

  it("turns an HTML-only reply into text", () => {
    expect(htmlToText("<div>Hi&nbsp;there<br>Can you do <b>Friday</b>?</div><style>x{}</style>")).toBe("Hi there\nCan you do Friday?");
  });
});

describe("Resend webhook signatures", () => {
  const secretBytes = Buffer.from("test-secret-key-1234567890");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const now = new Date("2026-11-10T00:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const sign = (b: string) => `v1,${createHmac("sha256", secretBytes).update(`msg_1.${ts}.${b}`).digest("base64")}`;

  it("accepts a correctly signed delivery", async () => {
    await expect(verifyResendWebhook({ secret, id: "msg_1", timestamp: ts, signature: `v1,bogus ${sign(body)}`, body, now })).resolves.toBe(true);
  });

  it("rejects a tampered body, a wrong secret or an old timestamp", async () => {
    await expect(verifyResendWebhook({ secret, id: "msg_1", timestamp: ts, signature: sign(body), body: body + " ", now })).resolves.toBe(false);
    await expect(verifyResendWebhook({ secret: `whsec_${Buffer.from("other").toString("base64")}`, id: "msg_1", timestamp: ts, signature: sign(body), body, now })).resolves.toBe(false);
    await expect(verifyResendWebhook({ secret, id: "msg_1", timestamp: ts, signature: sign(body), body, now: new Date(now.getTime() + 10 * 60_000) })).resolves.toBe(false);
    await expect(verifyResendWebhook({ secret: "", id: "msg_1", timestamp: ts, signature: sign(body), body, now })).resolves.toBe(false);
  });
});

describe("email reply notifications", () => {
  it("group per conversation and open the replies inbox", () => {
    const row = (body: string, at: string) => ({ id: at, lead_id: "L", kind: "email_reply", title: "Email from Jess", body, metadata: { recipient_id: id }, created_at: at, read_at: null });
    const [group] = buildFeed([row("Yes please", "2026-11-10T01:00:00Z"), row("Saturday?", "2026-11-10T02:00:00Z")]);
    expect(group).toMatchObject({ title: "Jess", subtitle: "Email replies", countLabel: "2 emails", action: "Reply", category: "messages" });
    expect(group!.link).toEqual({ to: "/campaigns/replies", search: { thread: id } });
  });
});
