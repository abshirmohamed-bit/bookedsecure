import { useRef } from "react";
import { FileText, Paperclip, Video, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MEDIA_ACCEPT, attachmentProblem, mediaKindOf, type LinkedInMediaKind, type LinkedInPostMedia } from "@/lib/linkedin-media";

export type Attachment = { id: string; file: File; url: string; kind: LinkedInMediaKind; altText: string };

type UploadPlan = {
  kind: LinkedInMediaKind;
  urn: string;
  parts: { ticket: string; firstByte: number; lastByte: number }[];
  uploadToken: string | null;
};

export type UploadDeps = {
  start: (input: { data: { kind: LinkedInMediaKind; fileSize: number; authorUrn: string | null } }) => Promise<UploadPlan>;
  finishVideo: (input: { data: { urn: string; uploadToken: string | null; etags: string[]; authorUrn: string | null } }) => Promise<unknown>;
};

/** Turns picked files into attachments, refusing a set LinkedIn wouldn't accept. */
export function addAttachments(current: Attachment[], picked: File[]): Attachment[] {
  const next = [...current.map((a) => a.file), ...picked];
  const problem = attachmentProblem(next);
  if (problem) {
    toast.error(problem);
    return current;
  }
  return [
    ...current,
    ...picked.map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      url: URL.createObjectURL(file),
      kind: mediaKindOf(file)!,
      altText: "",
    })),
  ];
}

/**
 * Sends each file to LinkedIn through BookedSecure's upload route, piece by
 * piece (videos come in several pieces), and returns what the post carries.
 * The LinkedIn token stays on the server; the browser only holds signed tickets.
 */
export async function uploadAttachments(
  attachments: Attachment[],
  options: { authorUrn: string | null; title: string; deps: UploadDeps; onProgress: (sent: number, total: number) => void },
): Promise<LinkedInPostMedia | null> {
  if (attachments.length === 0) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to upload.");
  const total = attachments.reduce((sum, a) => sum + a.file.size, 0);
  let sent = 0;
  const urns: string[] = [];
  for (const attachment of attachments) {
    const plan = await options.deps.start({ data: { kind: attachment.kind, fileSize: attachment.file.size, authorUrn: options.authorUrn } });
    const etags: string[] = [];
    for (const part of plan.parts) {
      const piece = attachment.file.slice(part.firstByte, part.lastByte + 1);
      const res = await fetch(`/api/linkedin/upload?ticket=${encodeURIComponent(part.ticket)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: piece,
      });
      const body = (await res.json().catch(() => ({}))) as { etag?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? `The ${attachment.kind} didn't upload.`);
      if (body.etag) etags.push(body.etag);
      sent += piece.size;
      options.onProgress(sent, total);
    }
    if (plan.kind === "video") {
      await options.deps.finishVideo({ data: { urn: plan.urn, uploadToken: plan.uploadToken, etags, authorUrn: options.authorUrn } });
    }
    urns.push(plan.urn);
  }
  const first = attachments[0]!;
  if (first.kind === "image") return { kind: "image", items: attachments.map((a, i) => ({ urn: urns[i]!, altText: a.altText || null })) };
  if (first.kind === "video") return { kind: "video", urn: urns[0]!, title: options.title || null };
  return { kind: "document", urn: urns[0]!, title: options.title || first.file.name.replace(/\.[^.]+$/, "") };
}

/** The attach button, the chosen files, alt text for images and a title for a video or document. */
export function AttachmentPicker({
  attachments,
  onChange,
  title,
  onTitle,
  disabled,
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  title: string;
  onTitle: (value: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const kind = attachments[0]?.kind ?? null;
  const remove = (id: string) => {
    const gone = attachments.find((a) => a.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    onChange(attachments.filter((a) => a.id !== id));
  };
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          if (picked.length) onChange(addAttachments(attachments, picked));
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || kind === "video" || kind === "document" || attachments.length >= 20}
          onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/80 disabled:opacity-50"
        >
          <Paperclip className="size-3.5" /> {attachments.length ? "Add more" : "Add photos, video or a document"}
        </button>
        <span className="text-[11px] text-muted-foreground">Up to 20 images (JPG, PNG, GIF), one MP4 video, or one PDF, PowerPoint or Word file.</span>
      </div>

      {attachments.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {attachments.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-xl border border-white/70 bg-white/60">
              {a.kind === "image" ? (
                <img src={a.url} alt="" className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square w-full place-items-center p-2 text-center text-[11px] text-muted-foreground">
                  {a.kind === "video" ? <Video className="size-6 text-primary" /> : <FileText className="size-6 text-primary" />}
                  <span className="line-clamp-2 break-all">{a.file.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={disabled}
                aria-label={`Remove ${a.file.name}`}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {kind === "image" && (
        <div className="space-y-1.5">
          {attachments.map((a, i) => (
            <Input
              key={a.id}
              value={a.altText}
              disabled={disabled}
              maxLength={300}
              onChange={(e) => onChange(attachments.map((x) => (x.id === a.id ? { ...x, altText: e.target.value } : x)))}
              placeholder={`Describe image ${i + 1} for people using screen readers (optional)`}
              className="h-8 text-xs"
            />
          ))}
        </div>
      )}
      {(kind === "document" || kind === "video") && (
        <Input
          value={title}
          disabled={disabled}
          maxLength={200}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={kind === "document" ? "Document title (shown above the carousel)" : "Video title (optional)"}
          className="h-9 text-sm"
        />
      )}
    </div>
  );
}

/** How the attached media looks in the post preview. */
export function MediaPreview({ attachments, title }: { attachments: Attachment[]; title: string }) {
  if (attachments.length === 0) return null;
  const first = attachments[0]!;
  if (first.kind === "video") {
    return <video src={first.url} controls className="max-h-80 w-full bg-black" />;
  }
  if (first.kind === "document") {
    return (
      <div className="flex items-center gap-3 border-y border-foreground/5 bg-secondary/60 px-4 py-6">
        <FileText className="size-8 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title || first.file.name}</p>
          <p className="text-[11px] text-muted-foreground">Shown as a swipeable document on LinkedIn</p>
        </div>
      </div>
    );
  }
  const shown = attachments.slice(0, 4);
  return (
    <div className={cn("grid gap-0.5", shown.length > 1 && "grid-cols-2")}>
      {shown.map((a, i) => (
        <div key={a.id} className="relative">
          <img src={a.url} alt={a.altText} className={cn("w-full object-cover", shown.length === 1 ? "max-h-96" : "aspect-square")} />
          {i === 3 && attachments.length > 4 && (
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-lg font-semibold text-white">+{attachments.length - 4}</span>
          )}
        </div>
      ))}
    </div>
  );
}
