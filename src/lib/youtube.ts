/**
 * YouTube posting rules shared by the browser and the server (no secrets here).
 * Videos go up through YouTube's official Data API v3 with resumable uploads.
 */

export const YOUTUBE_CALLBACK_PATH = "/api/public/youtube/oauth/callback";

/**
 * Upload videos, read the channel and its stats, read and answer comments
 * (force-ssl), and read YouTube Analytics (watch time, subscribers gained).
 */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

/** Whether a saved grant includes a scope (older connections predate comments and analytics). */
export const hasYouTubeScope = (scopes: string[] | null | undefined, suffix: "youtube.force-ssl" | "yt-analytics.readonly") =>
  (scopes ?? []).some((s) => s.endsWith(`/${suffix}`));

/** The 4-minute rule: 4 minutes or longer is long-form, shorter is short-form. */
export const LONG_FORM_SECONDS = 240;

/** ISO 8601 duration ("PT1H2M3S") to seconds. */
export function isoDurationSeconds(value: string | null | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value ?? "");
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
/** BookedSecure's own cap; YouTube allows far more but uploads run through the browser. */
export const YOUTUBE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Each piece sent through BookedSecure. YouTube needs multiples of 256 KiB except the last. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
export const YOUTUBE_CHUNK_UNIT = 256 * 1024;
export const YOUTUBE_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/mpeg,.mp4,.mov,.webm,.avi,.mkv,.mpg,.m4v";

export type YouTubePrivacy = "public" | "unlisted" | "private";

export function buildYouTubeAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  // A refresh token lets BookedSecure keep uploading without asking again.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

/** Only YouTube's own resumable upload address may be used with a business's token. */
export function isYouTubeUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/youtube/v3/videos" && url.searchParams.has("upload_id");
  } catch {
    return false;
  }
}

export function videoProblem(input: { title: string; description: string; fileSize: number; mimeType: string }): string | null {
  if (!input.title.trim()) return "Give the video a title.";
  if (input.title.length > YOUTUBE_TITLE_MAX) return `Titles can be up to ${YOUTUBE_TITLE_MAX} characters.`;
  if (/[<>]/.test(input.title) || /[<>]/.test(input.description)) return "YouTube doesn't allow < or > in titles or descriptions.";
  if (input.description.length > YOUTUBE_DESCRIPTION_MAX) return `Descriptions can be up to ${YOUTUBE_DESCRIPTION_MAX} characters.`;
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) return "Choose a video file.";
  if (input.fileSize > YOUTUBE_MAX_BYTES) return "Videos can be up to 2 GB here. Upload bigger ones in YouTube Studio.";
  if (input.mimeType && !/^video\//.test(input.mimeType) && input.mimeType !== "application/octet-stream") return "That file isn't a video.";
  return null;
}

/**
 * A scheduled video is uploaded now as private with a publish time; YouTube
 * makes it public then. Otherwise the chosen privacy applies straight away.
 */
export function videoStatus(privacy: YouTubePrivacy, publishAt: string | null, madeForKids: boolean) {
  return publishAt
    ? { privacyStatus: "private" as const, publishAt, selfDeclaredMadeForKids: madeForKids }
    : { privacyStatus: privacy, selfDeclaredMadeForKids: madeForKids };
}

/** The Content-Range for one piece, checked against YouTube's rules. */
export function chunkRange(start: number, length: number, total: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0) return null;
  const end = start + length - 1;
  if (end > total - 1) return null;
  if (end < total - 1 && length % YOUTUBE_CHUNK_UNIT !== 0) return null;
  return `bytes ${start}-${end}/${total}`;
}

/** YouTube's Range reply ("bytes=0-1234") gives the next byte to send. */
export function nextByteFrom(range: string | null): number {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

export const youtubeVideoUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

/** AI drafts come back as a title line, a blank line, then the description. */
export function splitDraft(text: string): { title: string; description: string } {
  const lines = text.trim().split(/\r?\n/);
  const title = (lines.shift() ?? "").replace(/^(title:\s*)/i, "").replace(/^["']|["']$/g, "").trim().slice(0, YOUTUBE_TITLE_MAX);
  const description = lines.join("\n").replace(/^(description:\s*)/im, "").trim().slice(0, YOUTUBE_DESCRIPTION_MAX);
  return { title, description };
}
