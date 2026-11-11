import { z } from "zod";

/** The choices on Co-work's Social media composer, and how Co-work is told about them. */
export const SOCIAL_PLATFORMS = [
  { id: "auto", label: "Best fit" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
] as const;
export const SOCIAL_FORMATS = [
  { id: "auto", label: "Auto", hint: "Co-work picks" },
  { id: "9:16", label: "9:16", hint: "Reels, Shorts, TikTok" },
  { id: "1:1", label: "1:1", hint: "Square feed post" },
  { id: "4:5", label: "4:5", hint: "Tall feed post" },
  { id: "16:9", label: "16:9", hint: "Wide video" },
] as const;
export const SOCIAL_STYLES = [
  { id: "auto", label: "Auto" },
  { id: "clean", label: "Clean & modern" },
  { id: "bold", label: "Bold" },
  { id: "minimal", label: "Minimalist" },
  { id: "luxury", label: "Luxury" },
  { id: "playful", label: "Playful" },
  { id: "natural", label: "Natural" },
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]["id"];
export type SocialFormat = (typeof SOCIAL_FORMATS)[number]["id"];
export type SocialStyle = (typeof SOCIAL_STYLES)[number]["id"];

const ids = <T extends readonly { id: string }[]>(list: T) => list.map((o) => o.id) as [T[number]["id"], ...T[number]["id"][]];

/** Fixed choices only, so nothing typed on the page can read as an instruction. */
export const assistantSurfaceSchema = z.object({
  area: z.literal("social"),
  platform: z.enum(ids(SOCIAL_PLATFORMS)),
  format: z.enum(ids(SOCIAL_FORMATS)),
  style: z.enum(ids(SOCIAL_STYLES)),
  videoId: z.string().uuid().optional(),
});
export type AssistantSurface = z.infer<typeof assistantSurfaceSchema>;

export function describeAssistantSurface(s: AssistantSurface): string {
  const label = <T extends readonly { id: string; label: string }[]>(list: T, id: string) => list.find((o) => o.id === id)?.label ?? id;
  const picks = [
    s.platform !== "auto" ? `Post to: ${label(SOCIAL_PLATFORMS, s.platform)}.` : "",
    s.format !== "auto" ? `Format: ${s.format}.` : "",
    s.style !== "auto" ? `Style: ${label(SOCIAL_STYLES, s.style)}.` : "",
    s.videoId ? `Attached video id: ${s.videoId}.` : "",
  ].filter(Boolean);
  return `[On the Social media page. ${picks.join(" ")}]`.replace(" ]", "]");
}

/** "Today", "Yesterday" or "Earlier", in the viewer's own day. */
export function resultDayLabel(iso: string, now = new Date()): "Today" | "Yesterday" | "Earlier" {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : "Earlier";
}

export function greetingFor(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
