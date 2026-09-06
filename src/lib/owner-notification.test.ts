// Tenant owner booking-confirmation SMS: policy, number roles, idempotency and
// isolation. Nothing here contacts a carrier or a database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  OWNER_BOOKING_CONFIRMED_TEMPLATE_ID,
  evaluateOwnerNotificationEligibility,
  ownerBookingConfirmationIdempotencyKey,
  renderOwnerBookingConfirmation,
  resolveOwnerNotificationNumber,
} from "./owner-notification";
import {
  BOOKING_CONFIRMATION_TEMPLATE_ID,
  BOOKING_CONFIRMATION_TEMPLATE_V2,
  resolveTenantCallbackNumber,
} from "./booking-confirmation";
import { bookingConfirmationIdempotencyKey } from "./booking";

const GLOCAST_SENDER = "+61468045220";
const OWNER_NUMBER = "+61447852565";
const CUSTOMER_NUMBER = "+61466907824";
const BOOKING_ID = "5a8eddb4-c217-4db8-b4a9-d4a038a402da";

const COMMITTED = {
  offerStatus: "confirmed",
  jobId: "d87fe609-b7d4-4910-9bd4-e9168dcb1dd2",
  ownerNotificationNumber: OWNER_NUMBER,
};

const serverSource = readFileSync("src/lib/owner-notification.server.ts", "utf8");
const bookingOnlySource = readFileSync("src/lib/booking-only.server.ts", "utf8");
const deliverySource = readFileSync("src/lib/sms/delivery.server.ts", "utf8");

describe("owner SMS is only ever produced by a committed booking", () => {
  it("draft intake creates no owner SMS", () => {
    const decision = evaluateOwnerNotificationEligibility({ ...COMMITTED, offerStatus: null, jobId: null });
    expect(decision.sendable).toBe(false);
    expect(decision.outcome).toBe("blocked_no_booking");
  });

  it("selecting a slot (offer created, not accepted) creates no owner SMS", () => {
    expect(
      evaluateOwnerNotificationEligibility({ ...COMMITTED, offerStatus: "offered", jobId: null }).sendable,
    ).toBe(false);
  });

  it("holding a slot (accepted, no job) creates no owner SMS", () => {
    expect(
      evaluateOwnerNotificationEligibility({ ...COMMITTED, offerStatus: "accepted", jobId: null }).sendable,
    ).toBe(false);
  });

  it("choosing a different time (withdrawn hold) creates no owner SMS", () => {
    const decision = evaluateOwnerNotificationEligibility({
      ...COMMITTED,
      offerStatus: "withdrawn",
      jobId: null,
    });
    expect(decision.sendable).toBe(false);
    expect(decision.outcome).toBe("blocked_cancelled");
  });

  it("failed, cancelled, abandoned or expired bookings create no owner SMS", () => {
    for (const status of ["expired", "withdrawn", "declined", null, undefined]) {
      expect(evaluateOwnerNotificationEligibility({ ...COMMITTED, offerStatus: status }).sendable).toBe(
        false,
      );
    }
  });

  it("final confirmation (confirmed offer + job) is the one sendable state", () => {
    const decision = evaluateOwnerNotificationEligibility(COMMITTED);
    expect(decision).toEqual({ outcome: "eligible", sendable: true, reason: "Eligible to send." });
  });

  it("is invoked only after the commit, from the post-commit finalizer", () => {
    // The finalizer runs only on a confirmed offer with a job (guarded above it).
    expect(bookingOnlySource).toContain('offer.status !== "confirmed" || !offer.job_id');
    expect(bookingOnlySource).toContain("deliverOwnerBookingConfirmation");
    // No queueing / scheduling: it is sent immediately, inline after commit.
    expect(serverSource).not.toMatch(/automation_jobs|run_at|confirmationReleaseAt/);
    // Never creates, moves or cancels a booking, job or lead state.
    expect(serverSource).not.toMatch(/from\("jobs"\)|from\("booking_offers"\)\s*\n\s*\.update|\.update\(/);
  });
});

describe("number roles stay separate", () => {
  it("owner SMS goes to the stored owner notification number", () => {
    expect(resolveOwnerNotificationNumber({ owner_notification_number: OWNER_NUMBER })).toBe(OWNER_NUMBER);
    expect(resolveOwnerNotificationNumber({ owner_notification_number: "0447 852 565" })).toBe(
      OWNER_NUMBER,
    );
  });

  it("blocks when the tenant stored no owner number, and substitutes nothing", () => {
    expect(resolveOwnerNotificationNumber({ owner_notification_number: null })).toBeNull();
    const decision = evaluateOwnerNotificationEligibility({ ...COMMITTED, ownerNotificationNumber: null });
    expect(decision.outcome).toBe("blocked_no_owner_number");
    expect(decision.sendable).toBe(false);
  });

  it("blocks an invalid stored owner number", () => {
    expect(
      evaluateOwnerNotificationEligibility({ ...COMMITTED, ownerNotificationNumber: "12345" }).outcome,
    ).toBe("blocked_invalid_owner_number");
  });

  it("owner SMS is sent from the tenant's own active primary sending line", () => {
    // The recipient is the stored owner number; the sender is resolved from the
    // tenant's sms_senders row, never from the owner field.
    expect(serverSource).toContain("resolveSender({ businessId: input.businessId })");
    expect(serverSource).toContain("provider.sendMessage({ to: ownerNumber, body, sender })");
    expect(serverSource).toContain("from_number: sender.phoneNumber");
    expect(serverSource).toContain("to_number: ownerNumber");
  });

  it("customer SMS keeps its own recipient and the tenant callback number", () => {
    // Customer TO comes from the lead's own mobile; FROM from the sender row.
    expect(readFileSync("src/lib/lead-engine.server.ts", "utf8")).toContain(
      "provider.sendMessage({ to: lead.mobile_number, body: input.body, sender })",
    );
    // The customer-facing callback number is the business phone, never the owner field.
    expect(resolveTenantCallbackNumber({ phone_number: GLOCAST_SENDER })).toBe(GLOCAST_SENDER);
    expect(readFileSync("src/lib/booking-confirmation.ts", "utf8")).not.toContain(
      "owner_notification_number",
    );
    expect(BOOKING_CONFIRMATION_TEMPLATE_V2).toContain("{{customer_callback_number}}");
    expect(CUSTOMER_NUMBER).not.toBe(OWNER_NUMBER);
  });

  it("is tenant scoped: every read filters on this business", () => {
    const scoped = serverSource.match(/\.eq\("business_id", input\.businessId\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(4);
    expect(serverSource).toContain('.eq("id", input.businessId)');
    // The owner number is read from this tenant's own row only.
    expect(serverSource).toContain("resolveOwnerNotificationNumber(business)");
  });
});

describe("owner template and rendering", () => {
  it("uses its own versioned template, distinct from the customer one", () => {
    expect(OWNER_BOOKING_CONFIRMED_TEMPLATE_ID).toBe("owner_booking_confirmed.v1");
    expect(OWNER_BOOKING_CONFIRMED_TEMPLATE_ID).not.toBe(BOOKING_CONFIRMATION_TEMPLATE_ID);
  });

  it("renders service, customer, suburb, date and time in the tenant timezone", () => {
    const { body, templateId } = renderOwnerBookingConfirmation({
      tenantName: "Glocast",
      serviceName: "Full Interior Detail",
      customerName: "Sam Rivers",
      suburb: "Bankstown",
      slotStart: "2026-09-08T01:00:00.000Z", // 11:00 am Sydney
      timezone: "Australia/Sydney",
    });
    expect(templateId).toBe(OWNER_BOOKING_CONFIRMED_TEMPLATE_ID);
    expect(body).toBe(
      "Glocast booking confirmed: Full Interior Detail for Sam Rivers in Bankstown on Tuesday 8 September at 11:00 am. Check the dashboard for full details.",
    );
  });

  it("never leaves an unfilled placeholder when fields are missing", () => {
    const { body } = renderOwnerBookingConfirmation({
      tenantName: "Glocast",
      serviceName: null,
      customerName: null,
      suburb: undefined,
      slotStart: "2026-09-08T01:00:00.000Z",
      timezone: "Australia/Sydney",
    });
    expect(body).not.toContain("{{");
  });
});

describe("idempotency and replay", () => {
  it("owner and customer keys are separate and stable", () => {
    expect(ownerBookingConfirmationIdempotencyKey(BOOKING_ID)).toBe(
      `tenant_owner_booking_confirmation:${BOOKING_ID}`,
    );
    expect(ownerBookingConfirmationIdempotencyKey(BOOKING_ID)).not.toBe(
      bookingConfirmationIdempotencyKey(BOOKING_ID),
    );
    expect(ownerBookingConfirmationIdempotencyKey(BOOKING_ID)).toBe(
      ownerBookingConfirmationIdempotencyKey(BOOKING_ID),
    );
    expect(ownerBookingConfirmationIdempotencyKey("other")).not.toBe(
      ownerBookingConfirmationIdempotencyKey(BOOKING_ID),
    );
  });

  it("a replay reuses the existing owner row instead of dispatching again", () => {
    expect(serverSource).toContain('.eq("idempotency_key", idempotencyKey)');
    expect(serverSource).toContain("canReuseOutboundRow(prior.delivery_status)");
    expect(serverSource).toContain('outcome: "duplicate_suppressed"');
  });

  it("a replay cannot duplicate the customer SMS, booking, job or dashboard alert", () => {
    // Customer SMS: keyed on the booking and short-circuited once sent.
    expect(readFileSync("src/lib/booking-confirmation.ts", "utf8")).toContain('outcome: "duplicate_suppressed"');
    // Dashboard alert: tenant + booking scoped key.
    expect(readFileSync("src/lib/booking-only-mode.ts", "utf8")).toContain(
      "`booking_confirmed:${input.businessId}:${input.offerId}`",
    );
    // Booking + job: the commit routine returns the same records on replay.
    expect(readFileSync("src/lib/booking-only.server.ts", "utf8")).toContain("replay");
  });
});

describe("failure behaviour", () => {
  it("records the attempt, provider id, status and failure reason", () => {
    expect(serverSource).toContain("provider_message_id: result.providerMessageId");
    expect(serverSource).toContain("failure_reason: detail");
    expect(serverSource).toContain('delivery_status: "failed"');
  });

  it("a failed owner SMS never rolls back the booking or the customer SMS", () => {
    // The finalizer swallows any owner-notification error after the commit.
    expect(bookingOnlySource).toMatch(/try \{[\s\S]*deliverOwnerBookingConfirmation[\s\S]*\} catch \{/);
    // The dashboard alert is created before the owner SMS is attempted.
    expect(bookingOnlySource.indexOf("createNotification")).toBeLessThan(
      bookingOnlySource.indexOf("deliverOwnerBookingConfirmation"),
    );
    // Nothing in the owner path touches booking_offers.status, jobs or the customer message.
    expect(serverSource).not.toContain('status: "withdrawn"');
    expect(serverSource).not.toContain("bookingConfirmationIdempotencyKey");
  });

  it("owner delivery outcomes never suppress the customer lead", () => {
    expect(deliverySource).toContain('recipient_role === "owner"');
    expect(deliverySource).toContain("if (!ownerAddressed && classification?.suppressLead)");
    expect(deliverySource).toContain("if (!ownerAddressed)\n    await rollUpLeadDeliveryState");
  });
});

describe("nothing unrelated runs", () => {
  it("the owner path starts no campaign, sequence, follow-up or AI outbound", () => {
    for (const forbidden of [
      "agent_actions",
      "sequence_campaigns",
      "automation_rules",
      "planSequence",
      "enqueueJob",
      "generate",
    ]) {
      expect(serverSource).not.toContain(forbidden);
    }
  });

  it("the dashboard booking-confirmed alert is still created alongside the owner SMS", () => {
    expect(bookingOnlySource).toContain("ownerBookingAlert");
    expect(bookingOnlySource).toContain("ownerAlerted: notified.created");
  });
});
