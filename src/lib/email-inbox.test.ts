import { describe, expect, it } from "vitest";
import {
  attachmentBelongsTo,
  attachmentPathFor,
  attachmentProblem,
  baseSubject,
  emailFrameDocument,
  forwardSubject,
  localPartProblem,
  mailboxLocalPartsFrom,
  messageIdsFrom,
  normaliseLocalPart,
  parseAddressList,
  quotedBlock,
  referencesFor,
  replyRecipients,
  replySubject,
  safeFileName,
  sanitizeEmailHtml,
  searchTerm,
} from "@/lib/email-inbox";

const BIZ = "11111111-2222-3333-4444-555555555555";

describe("business address", () => {
  it("normalises what the owner types", () => {
    expect(normaliseLocalPart(" Glocast Mobile ")).toBe("glocast-mobile");
    expect(normaliseLocalPart("Info@glocast.com.au")).toBe("info");
    expect(normaliseLocalPart("--a..b--")).toBe("a-b");
  });

  it("refuses reserved, short and malformed names", () => {
    expect(localPartProblem("admin")).toMatch(/kept for BookedSecure/);
    expect(localPartProblem("campaigns")).toMatch(/kept/);
    expect(localPartProblem("ab")).toMatch(/at least 3/);
    expect(localPartProblem("glocast")).toBeNull();
    expect(localPartProblem("glo_cast")).toMatch(/letters, numbers/);
  });

  it("finds business mailboxes among recipients, ignoring platform and other domains", () => {
    expect(mailboxLocalPartsFrom(["Glocast <Glocast@BookedSecure.com>", "admin@bookedsecure.com", "x@other.com", "glocast+quotes@bookedsecure.com", "a+1@reply.bookedsecure.com"]))
      .toEqual(["glocast"]);
  });
});

describe("threading", () => {
  it("strips reply and forward prefixes", () => {
    expect(baseSubject("Re: FW: RE: Quote for Friday")).toBe("Quote for Friday");
    expect(baseSubject("AW: Re[2]: Hello")).toBe("Hello");
    expect(replySubject("Re: Quote")).toBe("Re: Quote");
    expect(forwardSubject("Quote")).toBe("Fwd: Quote");
    expect(replySubject("")).toBe("Re: (no subject)");
  });

  it("reads message ids and builds References", () => {
    expect(messageIdsFrom("<a@x>", "<b@y> <a@x>")).toEqual(["<a@x>", "<b@y>"]);
    expect(referencesFor("<a@x> <b@y>", "<c@z>")).toBe("<a@x> <b@y> <c@z>");
    expect(referencesFor(null, null)).toBeNull();
  });

  it("works out reply and reply-all recipients without our own address", () => {
    const own = ["glocast@bookedsecure.com"];
    const incoming = { direction: "in" as const, from_email: "jess@x.com", to_emails: ["glocast@bookedsecure.com", "sam@y.com"], cc_emails: ["kim@z.com", "jess@x.com"] };
    expect(replyRecipients(incoming, own, false)).toEqual({ to: ["jess@x.com"], cc: [] });
    expect(replyRecipients(incoming, own, true)).toEqual({ to: ["jess@x.com"], cc: ["sam@y.com", "kim@z.com"] });
    const outgoing = { direction: "out" as const, from_email: "glocast@bookedsecure.com", to_emails: ["jess@x.com"], cc_emails: ["kim@z.com"] };
    expect(replyRecipients(outgoing, own, true)).toEqual({ to: ["jess@x.com"], cc: ["kim@z.com"] });
  });

  it("quotes replies and forwards", () => {
    const m = { from_email: "jess@x.com", from_name: "Jess", to_emails: ["glocast@bookedsecure.com"], subject: "Hi", created_at: "2026-11-13T00:00:00Z", body_text: "Line 1\nLine 2" };
    expect(quotedBlock("reply", m, "UTC")).toMatch(/Jess <jess@x.com> wrote:\n> Line 1\n> Line 2$/);
    expect(quotedBlock("forward", m, "UTC")).toMatch(/Forwarded message[\s\S]*Subject: Hi[\s\S]*Line 1/);
  });
});

describe("addresses", () => {
  it("parses lists and reports bad entries", () => {
    expect(parseAddressList("Jess <Jess@X.com>, sam@y.com; jess@x.com, nope")).toEqual({ emails: ["jess@x.com", "sam@y.com"], invalid: ["nope"] });
    expect(parseAddressList(["a@b.co", ""])).toEqual({ emails: ["a@b.co"], invalid: [] });
  });

  it("drops filter syntax from searches", () => {
    expect(searchTerm("a,b(c)%d*")).toBe("a b c d");
  });
});

describe("attachments", () => {
  it("blocks programs, empty and oversized files", () => {
    expect(attachmentProblem("invoice.pdf", 1000)).toBeNull();
    expect(attachmentProblem("setup.exe", 1000)).toMatch(/blocked/);
    expect(attachmentProblem("big.pdf", 11 * 1024 * 1024)).toMatch(/over 10 MB/);
    expect(attachmentProblem("empty.txt", 0)).toMatch(/empty/);
  });

  it("keeps paths inside the business's own mail folder", () => {
    const path = attachmentPathFor(BIZ, "../../Quote #1.pdf");
    expect(attachmentBelongsTo(path, BIZ)).toBe(true);
    expect(attachmentBelongsTo(path, "99999999-2222-3333-4444-555555555555")).toBe(false);
    expect(attachmentBelongsTo(`${BIZ}/logo.png`, BIZ)).toBe(false);
    expect(safeFileName("../../a b.pdf")).toBe("_.._a b.pdf");
  });
});

describe("received HTML", () => {
  it("removes scripts, frames, handlers and javascript links", () => {
    const html = `<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://e.com"></iframe><a href="javascript:alert(1)">x</a><img src="https://e.com/a.png" onerror=alert(1)><form action="/x"><input></form>`;
    const clean = sanitizeEmailHtml(html);
    expect(clean).not.toMatch(/script|iframe|onclick|onerror|javascript:|<form|<input/i);
    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain('src="https://e.com/a.png"');
  });

  it("wraps it with a strict content policy and new-tab links", () => {
    const doc = emailFrameDocument("<p>Hi</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<base target="_blank">');
  });
});
