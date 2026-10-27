import { describe, expect, it } from "vitest";
import {
  BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID,
  bookingConfirmationEmailIdempotencyKey,
  defaultEmailAssetUrls,
  evaluateBookingConfirmationEmailGate,
  renderBookingConfirmationEmailHtml,
  renderBookingConfirmationEmailSubject,
} from "@/lib/booking-confirmation-email";

const confirmed = {
  offerStatus: "confirmed",
  jobId: "job-1",
  leadEmail: "customer@example.com",
} as const;

describe("booking confirmation email gate", () => {
  it("defaults OFF — skipped_disabled with no env", () => {
    const d = evaluateBookingConfirmationEmailGate({ ...confirmed });
    expect(d.sendable).toBe(false);
    expect(d.outcome).toBe("skipped_disabled");
    expect(d.to).toBeNull();
  });

  it("enabled + TEST_TO sends only to the override (never customer)", () => {
    const d = evaluateBookingConfirmationEmailGate({
      ...confirmed,
      enabledEnv: "true",
      testToEnv: "info@glocast.com.au",
      leadEmail: "customer@example.com",
    });
    expect(d.sendable).toBe(true);
    expect(d.outcome).toBe("eligible");
    expect(d.to).toBe("info@glocast.com.au");
    expect(d.testOverride).toBe(true);
  });

  it("enabled without TEST_TO or ALLOW_CUSTOMER blocks customer send", () => {
    const d = evaluateBookingConfirmationEmailGate({
      ...confirmed,
      enabledEnv: "true",
    });
    expect(d.sendable).toBe(false);
    expect(d.outcome).toBe("skipped_customer_send_blocked");
  });

  it("enabled + ALLOW_CUSTOMER + no email → SMS-only skip", () => {
    const d = evaluateBookingConfirmationEmailGate({
      ...confirmed,
      enabledEnv: "true",
      allowCustomerEnv: "true",
      leadEmail: null,
    });
    expect(d.sendable).toBe(false);
    expect(d.outcome).toBe("skipped_no_email");
  });

  it("enabled + ALLOW_CUSTOMER + email → eligible to customer", () => {
    const d = evaluateBookingConfirmationEmailGate({
      ...confirmed,
      enabledEnv: "true",
      allowCustomerEnv: "true",
      leadEmail: "Customer@Example.COM",
    });
    expect(d.sendable).toBe(true);
    expect(d.to).toBe("customer@example.com");
    expect(d.testOverride).toBe(false);
  });

  it("TEST_TO wins over ALLOW_CUSTOMER (customer never used)", () => {
    const d = evaluateBookingConfirmationEmailGate({
      ...confirmed,
      enabledEnv: "true",
      allowCustomerEnv: "true",
      testToEnv: "qa@glocast.com.au",
      leadEmail: "customer@example.com",
    });
    expect(d.to).toBe("qa@glocast.com.au");
    expect(d.testOverride).toBe(true);
  });

  it("unconfirmed offer is skipped_no_booking", () => {
    const d = evaluateBookingConfirmationEmailGate({
      enabledEnv: "true",
      allowCustomerEnv: "true",
      leadEmail: "a@b.co",
      offerStatus: "offered",
      jobId: null,
    });
    expect(d.outcome).toBe("skipped_no_booking");
  });
});

describe("booking confirmation email render", () => {
  it("idempotency key is booking_confirm_email:{offerId}", () => {
    expect(bookingConfirmationEmailIdempotencyKey("abc-123")).toBe(
      "booking_confirm_email:abc-123",
    );
  });

  it("subject and HTML escape customer input and use absolute image URLs", () => {
    const subject = renderBookingConfirmationEmailSubject({
      customerName: "Alex <script>",
      serviceName: "Full Detail",
    });
    expect(subject).toContain("Alex");
    expect(subject).toContain("Full Detail");
    expect(subject).not.toContain("<script>");

    const { html, text, templateId } = renderBookingConfirmationEmailHtml({
      customerName: 'Sam & Co <b>',
      businessName: "Glocast",
      serviceName: "Interior Detail",
      vehicleLabel: "White SUV",
      address: "12 Smith St, Punchbowl",
      totalLabel: "$299",
      slotStart: "2026-11-05T01:00:00.000Z",
      timezone: "Australia/Sydney",
      phoneDisplay: "0447 852 565",
      phoneTel: "+61447852565",
      websiteUrl: "https://glocast.com.au",
      instagramUrl: "https://www.instagram.com/glocast.au",
      reviewsUrl: "https://glocast.com.au",
      rescheduleUrl: "https://bookedsecure.com/b/token",
      logoUrl: "https://bookedsecure.com/email/glocast-logo-gc-transparent-email560.png",
      heroUrl: "https://bookedsecure.com/email/glocast-hero-smiling.jpg",
    });
    expect(templateId).toBe(BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID);
    expect(html).toContain("Sam &amp; Co &lt;b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('src="https://bookedsecure.com/email/glocast-logo-gc-transparent-email560.png"');
    expect(html).toContain('src="https://bookedsecure.com/email/glocast-hero-smiling.jpg"');
    expect(html).toContain("tel:+61447852565");
    expect(html).toContain("Booking confirmed");
    expect(text).toContain("Interior Detail");
    expect(text).toContain("Australia/Sydney");
  });

  it("defaultEmailAssetUrls honour PUBLIC_APP_URL origin", () => {
    const urls = defaultEmailAssetUrls("https://bookedsecure.com/");
    expect(urls.logoUrl).toBe(
      "https://bookedsecure.com/email/glocast-logo-gc-transparent-email560.png",
    );
    expect(urls.heroUrl).toBe("https://bookedsecure.com/email/glocast-hero-smiling.jpg");
  });
});
