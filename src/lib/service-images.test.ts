import { describe, expect, it } from "vitest";
import {
  isOwnServiceImagePath,
  resolveRemoteImageUrl,
  sanitiseServiceImageUrl,
  serviceImageDisplayUrl,
  serviceImagePath,
} from "@/lib/service-images";
import { buildOnboardingProposal } from "@/lib/site-onboarding";

describe("service images", () => {
  it("keeps image paths inside the tenant's own folder", () => {
    const path = serviceImagePath("biz-1", "service", "svc-1", "jpg", "abc");
    expect(path).toBe("biz-1/service-svc-1-abc.jpg");
    expect(isOwnServiceImagePath("biz-1", path)).toBe(true);
    expect(isOwnServiceImagePath("biz-2", path)).toBe(false);
  });

  it("builds a cacheable public address", () => {
    expect(serviceImageDisplayUrl("addon", "row", "v1")).toBe("/api/public/service-image/addon/row?v=v1");
  });

  it("resolves relative site images and rejects unsafe schemes", () => {
    expect(resolveRemoteImageUrl("/img/interior.jpg", "https://shine.example/")).toBe(
      "https://shine.example/img/interior.jpg",
    );
    expect(resolveRemoteImageUrl("data:image/png;base64,AAAA", "https://shine.example/")).toBeNull();
    expect(resolveRemoteImageUrl("javascript:alert(1)", "https://shine.example/")).toBeNull();
    expect(resolveRemoteImageUrl(null, "https://shine.example/")).toBeNull();
  });

  it("only shows our own route or https pictures", () => {
    expect(sanitiseServiceImageUrl("/api/public/service-image/service/x?v=1")).toBe(
      "/api/public/service-image/service/x?v=1",
    );
    expect(sanitiseServiceImageUrl("http://insecure.example/a.jpg")).toBeNull();
    expect(sanitiseServiceImageUrl(null)).toBeNull();
  });

  it("carries a service picture through the proposal, or null when the site has none", () => {
    const proposal = buildOnboardingProposal(
      {
        services: [
          { name: "Interior detail", price: "$199", imageUrl: "https://shine.example/i.jpg" },
          { name: "Exterior wash", price: "$99" },
        ],
        addons: [{ name: "Pet hair removal", price: "+$40", imageUrl: "not a url" }],
      },
      "https://shine.example/",
    );
    expect(proposal.services[0]?.image_url).toBe("https://shine.example/i.jpg");
    expect(proposal.services[1]?.image_url).toBeNull();
    expect(proposal.addons[0]?.image_url).toBeNull();
  });
});
