import { describe, expect, it } from "vitest";
import {
  describeAddonLinkChange,
  findNameMatches,
  parseCatalogRequest,
  pickAddon,
  renderCatalogList,
} from "@/lib/catalog-actions";

const services = [
  { id: "s1", name: "Ceramic Coating" },
  { id: "s2", name: "Interior Detail" },
  { id: "s3", name: "Exterior Wash" },
];
const addons = [
  { id: "a1", name: "Mould Removal" },
  { id: "a2", name: "Pet Hair Removal" },
];

describe("catalogue request parsing", () => {
  it("recognises a listing question", () => {
    expect(parseCatalogRequest("Can you list all of my approved services and all of my add-ons?")).toEqual({
      kind: "list_catalog",
    });
  });

  it("recognises an all-services linking request", () => {
    const request = parseCatalogRequest("Make the Mould Removal add-on available for all services");
    expect(request?.kind).toBe("link_addon");
    expect(request && "allServices" in request && request.allServices).toBe(true);
  });

  it("recognises a named linking request", () => {
    const request = parseCatalogRequest(
      "Connect the Pet Hair Removal add-on to Interior Detail and Ceramic Coating",
    );
    expect(request?.kind).toBe("link_addon");
    expect(request && "allServices" in request && request.allServices).toBe(false);
  });

  it("recognises removal", () => {
    const request = parseCatalogRequest("Remove the Mould Removal add-on from Exterior Wash");
    expect(request && "remove" in request && request.remove).toBe(true);
  });

  it("ignores unrelated requests", () => {
    expect(parseCatalogRequest("Draft a win-back campaign at 10% off")).toBeNull();
    expect(parseCatalogRequest("")).toBeNull();
  });
});

describe("name resolution", () => {
  it("finds only the tenant's own names", () => {
    const matched = findNameMatches(
      "attach pet hair removal to interior detail and exterior wash",
      services,
    );
    expect(matched.map((row) => row.id).sort()).toEqual(["s2", "s3"]);
  });

  it("picks the add-on mentioned", () => {
    expect(pickAddon("make mould removal available everywhere", addons)?.id).toBe("a1");
    expect(pickAddon("make sunroof polish available", addons)).toBeNull();
  });
});

describe("descriptions", () => {
  it("summarises the change", () => {
    expect(
      describeAddonLinkChange({
        addonName: "Mould Removal",
        serviceNames: services.map((row) => row.name),
        remove: false,
        allServices: true,
      }),
    ).toContain("all 3 of your approved services");
  });

  it("lists the catalogue with link scope", () => {
    const text = renderCatalogList({
      services,
      addons: [
        { id: "a1", name: "Mould Removal", serviceIds: ["s1", "s2", "s3"] },
        { id: "a2", name: "Pet Hair Removal", serviceIds: [] },
      ],
    });
    expect(text).toContain("Approved services (3)");
    expect(text).toContain("Mould Removal: available with all services");
    expect(text).toContain("Pet Hair Removal: not linked to any service yet");
  });
});
