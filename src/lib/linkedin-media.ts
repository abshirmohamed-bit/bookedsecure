/**
 * What can be attached to a LinkedIn post, and how it goes into the post.
 * Pure: shared by the browser (checks before uploading) and the server.
 *
 * LinkedIn's own rules: up to 20 images (JPG, PNG, GIF) in one post, or one
 * MP4 video, or one document (PDF, PowerPoint, Word) shown as a carousel.
 */

export type LinkedInMediaKind = "image" | "video" | "document";

export const MEDIA_LIMITS = {
  image: { maxBytes: 20 * 1024 * 1024, maxCount: 20, types: ["image/jpeg", "image/png", "image/gif"], extensions: ["jpg", "jpeg", "png", "gif"] },
  video: { minBytes: 75 * 1024, maxBytes: 500 * 1024 * 1024, maxCount: 1, types: ["video/mp4"], extensions: ["mp4"] },
  // LinkedIn accepts up to 100MB; uploads pass through BookedSecure in one piece, so documents are kept smaller.
  document: {
    maxBytes: 30 * 1024 * 1024,
    maxCount: 1,
    types: [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: ["pdf", "ppt", "pptx", "doc", "docx"],
  },
} as const;

/** The accept= list for the file picker. */
export const MEDIA_ACCEPT = [
  ...MEDIA_LIMITS.image.types,
  ...MEDIA_LIMITS.video.types,
  ...MEDIA_LIMITS.document.types,
  ".jpg,.jpeg,.png,.gif,.mp4,.pdf,.ppt,.pptx,.doc,.docx",
].join(",");

export function mediaKindOf(file: { type?: string | null; name?: string | null }): LinkedInMediaKind | null {
  const type = (file.type ?? "").toLowerCase();
  const ext = (file.name ?? "").toLowerCase().split(".").pop() ?? "";
  for (const kind of ["image", "video", "document"] as const) {
    const limits = MEDIA_LIMITS[kind];
    if ((limits.types as readonly string[]).includes(type) || (limits.extensions as readonly string[]).includes(ext)) return kind;
  }
  return null;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Why a set of files can't go in one post, or null when it can. A post holds
 * images only, one video, or one document, never a mix.
 */
export function attachmentProblem(files: readonly { type?: string | null; name?: string | null; size: number }[]): string | null {
  if (files.length === 0) return null;
  const kinds = files.map(mediaKindOf);
  if (kinds.some((kind) => kind === null)) return "LinkedIn takes JPG, PNG or GIF images, MP4 video, or PDF, PowerPoint and Word documents.";
  const kind = kinds[0]!;
  if (kinds.some((k) => k !== kind)) return "A LinkedIn post can have images, or one video, or one document, but not a mix.";
  const limits = MEDIA_LIMITS[kind];
  if (files.length > limits.maxCount) {
    return kind === "image" ? "A LinkedIn post can have up to 20 images." : `A LinkedIn post can have one ${kind}.`;
  }
  for (const file of files) {
    if (file.size > limits.maxBytes) return `${file.name ?? "That file"} is too big (${megabytes(file.size)}). The limit for a ${kind} is ${megabytes(limits.maxBytes)}.`;
    if (kind === "video" && file.size < MEDIA_LIMITS.video.minBytes) return "That video is too small for LinkedIn (at least 75KB).";
  }
  return null;
}

/** What a post carries besides its text, once the files are on LinkedIn. */
export type LinkedInPostMedia =
  | { kind: "image"; items: { urn: string; altText?: string | null | undefined }[] }
  | { kind: "video"; urn: string; title?: string | null | undefined }
  | { kind: "document"; urn: string; title: string };

const URN = {
  image: /^urn:li:image:[\w-]+$/,
  video: /^urn:li:video:[\w-]+$/,
  document: /^urn:li:document:[\w-]+$/,
};

/** Checks media sent back by the browser before it goes into a post. */
export function mediaProblem(media: LinkedInPostMedia | null | undefined): string | null {
  if (!media) return null;
  if (media.kind === "image") {
    if (media.items.length < 1 || media.items.length > 20) return "A post can have 1 to 20 images.";
    if (media.items.some((item) => !URN.image.test(item.urn))) return "One of the images didn't upload properly.";
    return null;
  }
  if (media.kind === "video") return URN.video.test(media.urn) ? null : "The video didn't upload properly.";
  if (!URN.document.test(media.urn)) return "The document didn't upload properly.";
  return media.title.trim() ? null : "Give the document a title. LinkedIn shows it above the carousel.";
}

/** The `content` part of a LinkedIn post for the attached media. */
export function postContentFor(media: LinkedInPostMedia | null | undefined): Record<string, unknown> | null {
  if (!media) return null;
  if (media.kind === "image") {
    const items = media.items.map((item) => ({ id: item.urn, ...(item.altText?.trim() ? { altText: item.altText.trim().slice(0, 4086) } : {}) }));
    return items.length === 1 ? { media: items[0] } : { multiImage: { images: items } };
  }
  if (media.kind === "video") return { media: { id: media.urn, ...(media.title?.trim() ? { title: media.title.trim().slice(0, 200) } : {}) } };
  return { media: { id: media.urn, title: media.title.trim().slice(0, 200) } };
}

/** Short summary kept with the post history, e.g. "3 images" or "Document: Price guide". */
export function mediaSummary(media: LinkedInPostMedia | null | undefined): string | null {
  if (!media) return null;
  if (media.kind === "image") return media.items.length === 1 ? "1 image" : `${media.items.length} images`;
  if (media.kind === "video") return "Video";
  return `Document: ${media.title}`;
}

/** Upload addresses LinkedIn hands out are always on LinkedIn's own hosts. */
export function isLinkedInUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com") || url.hostname.endsWith(".licdn.com"));
  } catch {
    return false;
  }
}
