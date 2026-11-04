import { createHmac } from "node:crypto";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapMetaLead, metaLeadEvents, verifyMetaSignature } from "./meta-leads.server.ts";

test("only signed webhook payloads are accepted", () => {
  const body = JSON.stringify({ object: "page" });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, signature, "secret"), true);
  assert.equal(verifyMetaSignature(`${body} `, signature, "secret"), false);
  assert.equal(verifyMetaSignature(body, "sha256=bad", "secret"), false);
});

test("only the configured page and form leadgen events are processed", () => {
  const event = (form_id: string) => ({ field: "leadgen", value: { page_id: "123", form_id, leadgen_id: "456" } });
  const payload = { object: "page", entry: [{ id: "123", changes: [event("789"), event("other")] }] };
  assert.deepEqual(metaLeadEvents(payload, "123", "789"), [{ leadId: "456", formId: "789", adId: null }]);
  assert.deepEqual(metaLeadEvents(payload, "another-page", "789"), []);
});

test("Meta answers require an exact configured consent value to enable SMS", () => {
  const lead = { id: "456", field_data: [
    { name: "full_name", values: ["Sam D'Imperio"] },
    { name: "phone_number", values: ["0412 345 678"] },
    { name: "sms_opt_in", values: ["Yes"] },
  ] };
  assert.equal(mapMetaLead(lead, undefined, undefined).consent, false);
  assert.equal(mapMetaLead(lead, "sms_opt_in", "Yes").consent, true);
  assert.equal(mapMetaLead(lead, "sms_opt_in", "yes").consent, false);
  assert.equal(mapMetaLead(lead, "sms_opt_in", "Yes").name, "Sam D'Imperio");
});
