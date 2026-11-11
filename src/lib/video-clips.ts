/** Rules for video clipping, shared by the server, Co-Work and the Social page. */

export const VIDEO_ASPECTS = ["9:16", "1:1", "4:5", "16:9"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
/** Clips rendered without being asked, so the best ones are ready to watch. */
export const AUTO_RENDER_COUNT = 3;

export const ACTIVE_JOB_STATUSES = ["INGESTING", "IMPORTING", "QUEUED", "PROCESSING"] as const;
export type VideoJobStatus = "UPLOADING" | "WAITING" | "COMPLETED" | "FAILED" | (typeof ACTIVE_JOB_STATUSES)[number];

export function isActiveJob(status: string): boolean {
  return status === "UPLOADING" || (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

/** What the owner sees while a video is being worked on. */
export function jobStatusLabel(job: { status: string; stage?: string | null }): string {
  switch (job.status) {
    case "UPLOADING": return "Uploading";
    case "INGESTING":
    case "IMPORTING": return "Getting your video ready";
    case "WAITING": return "Ready when you are";
    case "QUEUED": return "Waiting its turn";
    case "COMPLETED": return "Clips ready";
    case "FAILED": return "Couldn't finish";
    default: break;
  }
  const stage = (job.stage ?? "").toLowerCase();
  if (stage === "transcribing") return "Listening to your video";
  if (stage === "finding") return "Finding the best moments";
  if (stage === "framing") return "Framing the shots";
  if (stage === "building" || stage === "finalizing") return "Cutting your clips";
  return "Working on it";
}

/**
 * Only public https addresses may be handed to the Engine, so nobody can point
 * it at its own host's private network.
 */
export function isPublicVideoLink(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host);
}

/** The highest-scoring clips, best first, for rendering straight away. */
export function clipsToRender<T extends { id: string; score: number | null }>(clips: readonly T[], count = AUTO_RENDER_COUNT): T[] {
  return [...clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, count);
}
