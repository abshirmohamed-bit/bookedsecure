import { describe, expect, it } from "vitest";
import {
  BOOKING_EMAIL_FIELDS,
  checkBookingEmail,
  DEFAULT_BOOKING_EMAIL,
  fillBookingEmail,
  formatAddress,
  formatPrice,
  htmlToText,
  imageBytesMatch,
  readBookingEmailSettings,
  sampleBookingEmailValues,
  unknownFields,
} from "@/lib/booking-email";

const values = sampleBookingEmailValues("Glocast", "0400 111 222");

describe("booking confirmation email", () => {
  it("fills every merge field the owner asked for", () => {
    const out = fillBookingEmail("{{name}}|{{service}}|{{date}}|{{time}}|{{address}}|{{price}}|{{business_name}}", values, "html");
    expect(out).toBe("Sam Taylor|Full detail|Friday 14 November|9:30 am|12 Example Street, Parramatta|$280|Glocast");
  });

  it("escapes customer values in HTML so a name can't change the email", () => {
    const out = fillBookingEmail("<p>Hi {{first_name}}</p>", { ...values, first_name: '<img src=x onerror="a">' }, "html");
    expect(out).toBe("<p>Hi &lt;img src=x onerror=&quot;a&quot;&gt;</p>");
  });

  it("keeps the subject plain text on one line", () => {
    expect(fillBookingEmail("Booked: {{service}}", { ...values, service: "Wash\r\nand <wax>" }, "text")).toBe("Booked: Wash and <wax>");
  });

  it("tolerates spacing and case in merge fields, and drops unknown ones", () => {
    expect(fillBookingEmail("{{ Service }}{{nope}}", values, "text")).toBe("Full detail");
    expect(unknownFields("{{service}} {{nope}} {{ nope }}")).toEqual(["nope"]);
  });

  it("the built-in design passes its own checks and uses only known fields", () => {
    expect(checkBookingEmail(DEFAULT_BOOKING_EMAIL)).toEqual([]);
    expect(BOOKING_EMAIL_FIELDS.map((f) => f.key)).toEqual(expect.arrayContaining(["name", "service", "date", "time", "address", "price"]));
  });

  it("refuses scripts, unknown fields and a bad reply-to", () => {
    const problems = checkBookingEmail({ ...DEFAULT_BOOKING_EMAIL, html: "<script>x</script>{{coupon}}", replyTo: "nope" });
    expect(problems.join(" ")).toMatch(/script/);
    expect(problems.join(" ")).toMatch(/\{\{coupon\}\}/);
    expect(problems.join(" ")).toMatch(/reply-to/);
  });

  it("reads stored settings defensively", () => {
    expect(readBookingEmailSettings(null)).toEqual(DEFAULT_BOOKING_EMAIL);
    expect(readBookingEmailSettings({ enabled: false, subject: "", html: 3, replyTo: "Me@Example.com" }))
      .toEqual({ ...DEFAULT_BOOKING_EMAIL, enabled: false, replyTo: "me@example.com" });
  });

  it("never prints an empty price or address", () => {
    expect(formatPrice(null)).toBe("To be confirmed");
    expect(formatPrice(0)).toBe("To be confirmed");
    expect(formatPrice(1250.5)).toBe("$1,250.5");
    expect(formatAddress(null, null)).toBe("To be confirmed");
    expect(formatAddress("12 Example St", "Parramatta")).toBe("12 Example St, Parramatta");
    expect(formatAddress("12 Example St, Parramatta", "Parramatta")).toBe("12 Example St, Parramatta");
  });

  it("makes a readable plain-text twin", () => {
    const text = htmlToText("<style>p{}</style><p>Hi Sam</p><table><tr><td>Date</td><td>Friday</td></tr></table>");
    expect(text).toBe("Hi Sam\nDate Friday");
  });

  it("checks uploaded pictures are what they claim", () => {
    expect(imageBytesMatch("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(imageBytesMatch("image/jpeg", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
