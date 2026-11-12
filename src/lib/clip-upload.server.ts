/**
 * Videos made in the browser go straight to the clip bucket (Tigris, the
 * same bucket the Engine writes to), through a short-lived signed upload
 * link. Only BookedSecure signs it, scoped to one key under the business's
 * own folder, so a browser can never write anywhere else.
 *
 * Secrets: TIGRIS_ACCESS_KEY_ID and TIGRIS_SECRET_ACCESS_KEY (a key with
 * write access to the bucket). Optional: TIGRIS_BUCKET, TIGRIS_ENDPOINT and
 * TIGRIS_PUBLIC_BASE_URL. Without the key, saving falls back to the Engine.
 */
import { AwsClient } from "aws4fetch";

const UPLOAD_TTL_S = 30 * 60;

function config() {
  const bucket = process.env["TIGRIS_BUCKET"]?.trim() || "long-glitter-1327";
  return {
    accessKeyId: process.env["TIGRIS_ACCESS_KEY_ID"]?.trim() || "",
    secretAccessKey: process.env["TIGRIS_SECRET_ACCESS_KEY"]?.trim() || "",
    bucket,
    endpoint: (process.env["TIGRIS_ENDPOINT"]?.trim() || "https://fly.storage.tigris.dev").replace(/\/+$/, ""),
    publicBase: (process.env["TIGRIS_PUBLIC_BASE_URL"]?.trim() || `https://${bucket}.t3.tigrisfiles.io`).replace(/\/+$/, ""),
  };
}

/** Whether a browser can save a video it made (the upload key is set). */
export function browserUploadsReady(): boolean {
  const c = config();
  return Boolean(c.accessKeyId && c.secretAccessKey);
}

/** Where one browser-made clip video goes, inside the business's own folder. */
export function clipVideoKey(businessId: string, clipId: string): string {
  return `browser-renders/${businessId}/${clipId}/${Date.now()}.mp4`;
}

export function publicUrlFor(key: string): string {
  return `${config().publicBase}/${key}`;
}

/** A signed PUT link for exactly `key`, valid for half an hour. */
export async function signedUploadUrl(key: string): Promise<string> {
  const c = config();
  if (!browserUploadsReady()) throw new Error("Saving videos made in the browser isn't switched on yet.");
  const aws = new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(`${c.endpoint}/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL_S));
  const signed = await aws.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return signed.url;
}

/** The size of an uploaded video, or 0 if it isn't there. */
export async function uploadedSize(key: string): Promise<number> {
  try {
    const res = await fetch(publicUrlFor(key), { method: "HEAD", redirect: "manual" });
    return res.ok ? Number(res.headers.get("content-length") ?? 0) : 0;
  } catch {
    return 0;
  }
}
