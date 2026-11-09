import { describe, expect, it } from "vitest";
import { CAMPAIGN_TEMPLATES, initials, previewParagraphs } from "./campaign-templates";
import { buildEmailHtml } from "./email-campaigns";

describe("campaign composer helpers", () => {
  it("previews the same paragraphs the sent email renders", () => {
    const body = "Hi there,\n\nLine one\nLine two\n\n\nThanks";
    expect(previewParagraphs(body)).toEqual([["Hi there,"], ["Line one", "Line two"], ["Thanks"]]);
    const html = buildEmailHtml({ businessName: "Glocast", bodyText: body, unsubscribeUrl: "https://x" });
    expect(html.match(/<p style="margin:0 0 16px/g)).toHaveLength(3);
  });

  it("signs templates with the business name and never uses merge fields", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const body = template.body("Glocast");
      expect(body.endsWith("Glocast")).toBe(true);
      expect(body).not.toMatch(/[{}[\]]/);
      expect(template.body(null).endsWith("Thanks,")).toBe(true);
    }
  });

  it("makes initials from a name or an email", () => {
    expect(initials("George Superior", null)).toBe("GS");
    expect(initials(null, "nouha1989@hotmail.com")).toBe("NH");
    expect(initials("Sam", null)).toBe("SA");
    expect(initials(null, null)).toBe("?");
  });
});
