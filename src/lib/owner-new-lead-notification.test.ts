import { describe, expect, it } from "vitest";
import {
  evaluateOwnerNewLeadEligibility,
  OWNER_NEW_LEAD_TEMPLATE_ID,
  ownerNewLeadSmsIdempotencyKey,
  renderOwnerNewLeadAlert,
} from "./owner-new-lead-notification";

const OWNER = "+61447852565";

describe("new-lead owner SMS eligibility", () => {
  it("allows a tenant with a valid owner mobile and unmuted new-lead alerts", () => {
    expect(evaluateOwnerNewLeadEligibility({ ownerNotificationNumber: OWNER, mutedKinds: [] }).sendable).toBe(true);
  });

  it("does not substitute a number when the tenant has none", () => {
    const result = evaluateOwnerNewLeadEligibility({ ownerNotificationNumber: null, mutedKinds: [] });
    expect(result.sendable).toBe(false);
    expect(result.outcome).toBe("blocked_no_owner_number");
  });

  it("rejects an owner number that cannot receive SMS", () => {
    const result = evaluateOwnerNewLeadEligibility({ ownerNotificationNumber: "0298765432", mutedKinds: [] });
    expect(result.sendable).toBe(false);
    expect(result.outcome).toBe("blocked_invalid_owner_number");
  });

  it("honours the tenant's new-enquiry mute", () => {
    const result = evaluateOwnerNewLeadEligibility({ ownerNotificationNumber: OWNER, mutedKinds: ["new_lead"] });
    expect(result.sendable).toBe(false);
    expect(result.outcome).toBe("blocked_muted");
  });
});

describe("new-lead owner SMS identity", () => {
  it("uses a stable, separate key for each durable owner alert", () => {
    expect(ownerNewLeadSmsIdempotencyKey("lead:one:owner_alert")).toBe("tenant_owner_new_lead:lead:one:owner_alert");
    expect(ownerNewLeadSmsIdempotencyKey("lead:one:owner_alert")).not.toBe(ownerNewLeadSmsIdempotencyKey("lead:two:owner_alert"));
  });

  it("uses a versioned owner-only template", () => {
    expect(OWNER_NEW_LEAD_TEMPLATE_ID).toBe("owner_new_lead.v1");
  });

  it("bounds untrusted lead fields before segment accounting", () => {
    const { body } = renderOwnerNewLeadAlert({
      tenantName: "Tenant",
      customerName: "A".repeat(500),
      customerMobile: OWNER,
      serviceName: null,
      suburb: null,
    });
    expect(body.length).toBeLessThan(180);
    expect(body).toContain(OWNER);
  });
});
