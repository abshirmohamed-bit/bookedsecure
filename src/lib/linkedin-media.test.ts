import { describe, expect, it } from "vitest";
import { attachmentProblem, isLinkedInUploadUrl, mediaKindOf, mediaProblem, postContentFor } from "./linkedin-media";
import { buildPostBody } from "./linkedin";

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("what can be attached to a LinkedIn post", () => {
  it("knows images, videos and documents by type or extension", () => {
    expect(mediaKindOf(f("a.jpg", "image/jpeg"))).toBe("image");
    expect(mediaKindOf(f("clip.MP4", ""))).toBe("video");
    expect(mediaKindOf(f("deck.pptx", ""))).toBe("document");
    expect(mediaKindOf(f("notes.txt", "text/plain"))).toBeNull();
  });

  it("allows up to 20 images, or one video, or one document, never a mix", () => {
    expect(attachmentProblem([f("a.png", "image/png"), f("b.gif", "image/gif")])).toBeNull();
    expect(attachmentProblem(Array.from({ length: 21 }, (_, i) => f(`${i}.jpg`, "image/jpeg")))).toMatch(/up to 20/);
    expect(attachmentProblem([f("a.jpg", "image/jpeg"), f("b.mp4", "video/mp4", 200_000)])).toMatch(/not a mix/);
    expect(attachmentProblem([f("a.pdf", "application/pdf"), f("b.pdf", "application/pdf")])).toMatch(/one document/);
    expect(attachmentProblem([f("big.pdf", "application/pdf", 40 * 1024 * 1024)])).toMatch(/too big/);
    expect(attachmentProblem([f("tiny.mp4", "video/mp4", 10)])).toMatch(/too small/);
    expect(attachmentProblem([f("x.exe", "application/octet-stream")])).toMatch(/JPG, PNG or GIF/);
  });

  it("builds the post content LinkedIn expects", () => {
    expect(postContentFor({ kind: "image", items: [{ urn: "urn:li:image:A", altText: "Van" }] })).toEqual({ media: { id: "urn:li:image:A", altText: "Van" } });
    expect(postContentFor({ kind: "image", items: [{ urn: "urn:li:image:A" }, { urn: "urn:li:image:B" }] })).toEqual({
      multiImage: { images: [{ id: "urn:li:image:A" }, { id: "urn:li:image:B" }] },
    });
    expect(postContentFor({ kind: "document", urn: "urn:li:document:D", title: "Price guide" })).toEqual({ media: { id: "urn:li:document:D", title: "Price guide" } });
    expect(buildPostBody("urn:li:person:x", "Hi", postContentFor({ kind: "video", urn: "urn:li:video:V" }))).toMatchObject({ content: { media: { id: "urn:li:video:V" } } });
    expect(buildPostBody("urn:li:person:x", "Hi")).not.toHaveProperty("content");
  });

  it("rejects media that didn't come from LinkedIn and documents without a title", () => {
    expect(mediaProblem({ kind: "image", items: [{ urn: "https://evil.example/x.png" }] })).toMatch(/didn't upload/);
    expect(mediaProblem({ kind: "document", urn: "urn:li:document:D", title: " " })).toMatch(/title/);
    expect(mediaProblem({ kind: "video", urn: "urn:li:video:V" })).toBeNull();
  });

  it("only uploads to LinkedIn's own addresses", () => {
    expect(isLinkedInUploadUrl("https://www.linkedin.com/dms-uploads/abc")).toBe(true);
    expect(isLinkedInUploadUrl("https://media.licdn.com/x")).toBe(true);
    expect(isLinkedInUploadUrl("https://linkedin.com.evil.example/x")).toBe(false);
    expect(isLinkedInUploadUrl("http://www.linkedin.com/x")).toBe(false);
  });
});
