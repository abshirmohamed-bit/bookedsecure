import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildTextoSendPayload,
  flattenTextoPayload,
  mapTextoStatus,
  verifyTextoSignature,
} from "./texto.server";

describe("texto payload normalisation", () => {
  it("flattens an inbound reply", () => {
    const flat = flattenTextoPayload({
      event: "message.inbound",
      message_id: "in_1",
      from: "+61466907824",
      to: "+61480000000",
      body: "STOP",
      received_at: "2026-01-01T00:00:00Z",
      is_optout: true,
    });
    expect(flat).toMatchObject({ eventType: "message.inbound", messageId: "in_1", isOptout: true });
    expect(flat.status).toBeNull();
  });

  it("flattens a delivery receipt", () => {
    const flat = flattenTextoPayload({
      message: { id: "m_1", recipient: "+61466907824", status: "sent" },
      delivery_receipt: { status: "delivered", received_at: "2026-01-01T00:01:00Z" },
    });
    expect(flat.messageId).toBe("m_1");
    expect(mapTextoStatus(flat.status)).toBe("delivered");
  });

  it("maps unknown statuses conservatively", () => {
    expect(mapTextoStatus("weird")).toBe("unknown");
    expect(mapTextoStatus(null)).toBe("unknown");
  });

  it("builds a send payload in E.164", () => {
    expect(buildTextoSendPayload({ to: "+61466907824", from: "+61480000000", body: "hi" })).toEqual({
      to: "+61466907824",
      message: "hi",
      sender: "+61480000000",
    });
  });
});

describe("texto signature verification", () => {
  const raw = JSON.stringify({ message_id: "in_1" });
  const secret = "shh";

  it("accepts a matching signature", async () => {
    const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const headers = new Headers({ "x-texto-signature": `sha256=${sig}` });
    expect(await verifyTextoSignature({ headers, rawBody: raw, secret })).toEqual({ verified: true });
  });

  it("rejects a tampered body and a missing header", async () => {
    const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const bad = await verifyTextoSignature({
      headers: new Headers({ "x-texto-signature": `sha256=${sig}` }),
      rawBody: `${raw} `,
      secret,
    });
    expect(bad.verified).toBe(false);
    const none = await verifyTextoSignature({ headers: new Headers(), rawBody: raw, secret });
    expect(none.verified).toBe(false);
  });
});
