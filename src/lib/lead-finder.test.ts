import { describe, expect, it } from "vitest";
import { emailStatusFromZeroBounce, emailsOnPage, hostOf, placesQuery, readFit, searchProblem, suburbFromAddress } from "./lead-finder";

describe("lead finder rules", () => {
  it("checks the search", () => {
    expect(searchProblem({ what: "cl", where: "Auburn" })).toMatch(/kind of business/);
    expect(searchProblem({ what: "cleaners", where: "" })).toMatch(/where/);
    expect(searchProblem({ what: "cleaners", where: "Auburn", criteria: "<script>" })).toMatch(/</);
    expect(searchProblem({ what: "cleaners", where: "Auburn NSW" })).toBeNull();
    expect(placesQuery(" cleaners ", " Auburn NSW ")).toBe("cleaners in Auburn NSW");
  });

  it("keeps only real published contact emails, own-domain first", () => {
    const page = "Contact us: info@sparkle.com.au or sam.smith@gmail.com. logo@2x.png noreply@sparkle.com.au user@example.com";
    expect(emailsOnPage(page, "https://www.sparkle.com.au")).toEqual(["info@sparkle.com.au", "sam.smith@gmail.com"]);
    expect(emailsOnPage("nothing here", null)).toEqual([]);
  });

  it("reads hosts, suburbs, fit and email checks", () => {
    expect(hostOf("www.sparkle.com.au/contact")).toBe("sparkle.com.au");
    expect(suburbFromAddress("12 Rawson St, Auburn NSW 2144, Australia")).toBe("Auburn");
    expect(suburbFromAddress(null)).toBeNull();
    expect(readFit("good")).toBe("good");
    expect(readFit("yes")).toBe("unknown");
    expect(emailStatusFromZeroBounce("valid")).toBe("valid");
    expect(emailStatusFromZeroBounce("catch-all")).toBe("risky");
    expect(emailStatusFromZeroBounce("spamtrap")).toBe("invalid");
  });
});
