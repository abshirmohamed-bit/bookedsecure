import { afterEach, describe, expect, it, vi } from "vitest";
import { browserUploadsReady, clipVideoKey, publicUrlFor, signedUploadUrl } from "@/lib/clip-upload.server";

afterEach(() => vi.unstubAllEnvs());

describe("browser-made clip uploads", () => {
  it("are off until the bucket key is set", async () => {
    vi.stubEnv("TIGRIS_ACCESS_KEY_ID", "");
    vi.stubEnv("TIGRIS_SECRET_ACCESS_KEY", "");
    expect(browserUploadsReady()).toBe(false);
    await expect(signedUploadUrl("browser-renders/b/c/1.mp4")).rejects.toThrow(/isn't switched on/);
  });

  it("keep each video inside its business and clip", () => {
    const key = clipVideoKey("biz-1", "clip-2");
    expect(key).toMatch(/^browser-renders\/biz-1\/clip-2\/\d+\.mp4$/);
    expect(publicUrlFor(key)).toBe(`https://long-glitter-1327.t3.tigrisfiles.io/${key}`);
  });

  it("sign a PUT for exactly one key, valid for half an hour", async () => {
    vi.stubEnv("TIGRIS_ACCESS_KEY_ID", "tid_test");
    vi.stubEnv("TIGRIS_SECRET_ACCESS_KEY", "tsec_test");
    expect(browserUploadsReady()).toBe(true);
    const url = new URL(await signedUploadUrl("browser-renders/biz-1/clip-2/1.mp4"));
    expect(url.origin).toBe("https://fly.storage.tigris.dev");
    expect(url.pathname).toBe("/long-glitter-1327/browser-renders/biz-1/clip-2/1.mp4");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Credential")).toContain("tid_test/");
  });
});
