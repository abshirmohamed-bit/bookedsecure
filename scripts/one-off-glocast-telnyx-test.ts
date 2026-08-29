// One-off operator-authorised internal test. Deleted immediately after use.
import { sendSms } from "@/lib/lead-engine.server";

const result = await sendSms({
  businessId: "11111111-1111-1111-1111-111111111111",
  leadId: "0df3a257-af5a-49c2-91b8-7b1dae027fbb",
  body: "BookedSecure test message for Glocast. Reply TEST-OK if received.",
  kind: "manual",
  respectAutomation: false,
  idempotencyKey: "0df3a257-af5a-49c2-91b8-7b1dae027fbb:internal_test:quiet_hours_exception:fa30397b",
});

console.log(JSON.stringify(result, null, 2));
