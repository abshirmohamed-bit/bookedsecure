import { describe, expect, it } from "vitest";
import { defaultReviewTemplate, renderReviewRequest, reviewDecision, reviewLinkIn, reviewTemplateProblem } from "./review-requests";

describe("review requests", () => {
  it("is due after the delay, and never for old jobs", () => {
    const done = "2026-11-10T00:00:00.000Z";
    expect(reviewDecision(done, 180, new Date("2026-11-10T02:00:00Z"))).toBe("not_yet");
    expect(reviewDecision(done, 180, new Date("2026-11-10T03:30:00Z"))).toBe("due");
    expect(reviewDecision(done, 180, new Date("2026-11-14T00:00:00Z"))).toBe("too_old");
    expect(reviewDecision(null, 180, new Date())).toBe("not_completed");
  });

  it("needs a link and fills in the customer and business", () => {
    expect(reviewTemplateProblem(defaultReviewTemplate(), null)).toMatch(/review link/);
    const template = defaultReviewTemplate().replace("{{review_link}}", "https://g.page/r/abc/review");
    expect(reviewTemplateProblem(template, null)).toBeNull();
    expect(renderReviewRequest(template, { customerName: "Sam Lee", businessName: "Glocast", reviewLink: null }))
      .toBe("Hi Sam, thanks for choosing Glocast! If you're happy with the job, a quick review would mean a lot: https://g.page/r/abc/review");
    expect(reviewLinkIn(template)).toBe("https://g.page/r/abc/review");
  });
});
