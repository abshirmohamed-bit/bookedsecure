import { describe, expect, it } from "vitest";
import { needsReply } from "./needs-reply";

describe("needsReply", () => {
  const base = { conversation_status: "needs_attention", status: "customer_replied" };

  it("counts a customer text nobody has answered", () => {
    expect(needsReply({ ...base, last_reply_at: "2026-11-13T02:00:00Z", last_outbound_sms_at: "2026-11-13T01:00:00Z" })).toBe(true);
    expect(needsReply({ ...base, last_reply_at: "2026-11-13T02:00:00Z", last_outbound_sms_at: null })).toBe(true);
  });

  it("drops leads the owner already answered", () => {
    expect(needsReply({ ...base, last_reply_at: "2026-11-13T01:00:00Z", last_outbound_sms_at: "2026-11-13T02:00:00Z" })).toBe(false);
  });

  it("drops booked, finished and closed leads", () => {
    for (const status of ["scheduled", "completed", "lost", "opted_out", "invalid"]) {
      expect(needsReply({ ...base, status, last_reply_at: "2026-11-13T02:00:00Z" })).toBe(false);
    }
  });

  it("ignores conversations not waiting on the owner", () => {
    expect(needsReply({ conversation_status: "open", status: "new" })).toBe(false);
  });
});
