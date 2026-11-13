import { describe, expect, it } from "vitest";
import { EMAIL_THEME_PRESETS, EXAMPLE_EMAIL_THEME, parseEmailTheme, readEmailTheme, resolveEmailLook, themeDefaultBookingHtml } from "@/lib/email-theme";
import { renderEmailHtml } from "@/lib/email-template";
import { DEFAULT_BOOKING_EMAIL_HTML } from "@/lib/booking-email";

describe("email theme", () => {
  it("accepts the example file", () => {
    expect(parseEmailTheme(JSON.stringify(EXAMPLE_EMAIL_THEME)).errors).toEqual([]);
  });
  it("ships only valid presets", () => {
    for (const p of EMAIL_THEME_PRESETS) expect(parseEmailTheme(JSON.stringify(p.theme)).errors).toEqual([]);
  });
  it("explains mistakes in plain words", () => {
    expect(parseEmailTheme("{nope").errors[0]).toMatch(/valid JSON/);
    const r = parseEmailTheme({ colors: { brand: "blue" }, font: "comic", html: "<b>" });
    expect(r.theme).toBeNull();
    expect(r.errors.join(" ")).toMatch(/colors.brand must be a colour/);
    expect(r.errors.join(" ")).toMatch(/font must be one of/);
    expect(r.errors.join(" ")).toMatch(/"html" isn't a template setting/);
  });
  it("draws the email with the theme and escapes the footer line", () => {
    const theme = readEmailTheme({ colors: { brand: "#ff6600" }, buttons: "pill", logo: { show: false }, footerNote: "<script>x</script>" });
    const html = renderEmailHtml({ businessName: "Acme", logoUrl: "https://x.test/l.png", theme }, { bodyText: "Hi", cta: { label: "Go", url: "https://x.test" } });
    expect(html).toContain("#ff6600");
    expect(html).toContain("border-radius:999px");
    expect(html).not.toContain("https://x.test/l.png");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("keeps the default look without a theme", () => {
    expect(resolveEmailLook(null).brand).toBe("#1e5fc2");
    expect(readEmailTheme("junk")).toBeNull();
  });
  it("themes only the unchanged built-in booking email", () => {
    const theme = readEmailTheme({ colors: { brand: "#123456" } });
    expect(themeDefaultBookingHtml(DEFAULT_BOOKING_EMAIL_HTML, DEFAULT_BOOKING_EMAIL_HTML, theme)).toContain("#123456");
    expect(themeDefaultBookingHtml("<p>mine</p>", DEFAULT_BOOKING_EMAIL_HTML, theme)).toBe("<p>mine</p>");
  });
});
