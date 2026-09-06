import { describe, expect, it } from "vitest";
import {
  isOwnTenantLogoPath,
  MAX_LOGO_BYTES,
  tenantLogoPath,
  validateLogoUpload,
} from "@/lib/tenant-logo";
import { sanitiseLogoUrl } from "@/lib/tenant-branding";

const BUSINESS = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("logo upload validation", () => {
  it("accepts PNG, JPEG and WebP within the size limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(validateLogoUpload({ contentType: type, size: 1024 }).ok).toBe(true);
    }
    expect(validateLogoUpload({ contentType: "IMAGE/PNG", size: 10 }).ok).toBe(true);
  });

  it("rejects unsupported and executable-ish file types", () => {
    for (const type of [
      "image/svg+xml",
      "text/html",
      "application/javascript",
      "application/x-msdownload",
      "application/pdf",
      "",
    ]) {
      const result = validateLogoUpload({ contentType: type, size: 1024 });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects empty and oversized files", () => {
    expect(validateLogoUpload({ contentType: "image/png", size: 0 }).ok).toBe(false);
    expect(validateLogoUpload({ contentType: "image/png", size: MAX_LOGO_BYTES + 1 }).ok).toBe(
      false,
    );
    expect(validateLogoUpload({ contentType: "image/png", size: MAX_LOGO_BYTES }).ok).toBe(true);
  });
});

describe("logo storage paths are tenant scoped", () => {
  it("always puts the business id first", () => {
    const path = tenantLogoPath(BUSINESS, "png", "abc-123");
    expect(path).toBe(`${BUSINESS}/logo-abc-123.png`);
    expect(isOwnTenantLogoPath(BUSINESS, path)).toBe(true);
  });

  it("never treats another tenant's path as its own", () => {
    const other = tenantLogoPath(OTHER, "png", "abc");
    expect(isOwnTenantLogoPath(BUSINESS, other)).toBe(false);
    expect(isOwnTenantLogoPath(BUSINESS, `${BUSINESS}/../${OTHER}/logo.png`)).toBe(false);
    expect(isOwnTenantLogoPath(BUSINESS, BUSINESS)).toBe(false);
    expect(isOwnTenantLogoPath(BUSINESS, null)).toBe(false);
  });

  it("strips unsafe characters from the file name", () => {
    expect(tenantLogoPath(BUSINESS, "p n/g", "a/../b")).toBe(`${BUSINESS}/logo-ab.png`);
  });
});

describe("logo rendering falls back safely", () => {
  it("keeps signed https URLs and rejects unsafe values", () => {
    expect(sanitiseLogoUrl("https://example.supabase.co/object/sign/tenant-logos/x?token=y")).toBe(
      "https://example.supabase.co/object/sign/tenant-logos/x?token=y",
    );
    expect(sanitiseLogoUrl("javascript:alert(1)")).toBeNull();
    expect(sanitiseLogoUrl(null)).toBeNull();
  });
});
