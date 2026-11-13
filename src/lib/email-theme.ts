/**
 * A business's email look (businesses.email_theme): an owner-uploaded JSON of
 * design choices only — colours, font, logo placement, button shape and a
 * footer line. Never HTML, so every email stays escaped, readable in every
 * mail client, and keeps its unsubscribe line. Pure: used by the template,
 * the server and the browser preview.
 */
import { z } from "zod";

export const EMAIL_FONTS = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  arial: "Arial,Helvetica,sans-serif",
  helvetica: "'Helvetica Neue',Helvetica,Arial,sans-serif",
  verdana: "Verdana,Geneva,sans-serif",
  trebuchet: "'Trebuchet MS',Helvetica,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  times: "'Times New Roman',Times,serif",
} as const;
export type EmailFont = keyof typeof EMAIL_FONTS;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const colour = (name: string) => z.string({ invalid_type_error: `${name} must be a colour like #1e5fc2` }).regex(HEX, `${name} must be a colour like #1e5fc2`);

const schema = z
  .object({
    version: z.literal(1).optional(),
    colors: z
      .object({
        brand: colour("colors.brand"),
        background: colour("colors.background"),
        card: colour("colors.card"),
        heading: colour("colors.heading"),
        text: colour("colors.text"),
        buttonText: colour("colors.buttonText"),
      })
      .partial()
      .strict()
      .optional(),
    font: z.enum(Object.keys(EMAIL_FONTS) as [EmailFont, ...EmailFont[]], { errorMap: () => ({ message: `font must be one of: ${Object.keys(EMAIL_FONTS).join(", ")}` }) }).optional(),
    logo: z
      .object({
        show: z.boolean({ invalid_type_error: "logo.show must be true or false" }),
        align: z.enum(["left", "center"], { errorMap: () => ({ message: "logo.align must be left or center" }) }),
      })
      .partial()
      .strict()
      .optional(),
    buttons: z.enum(["rounded", "square", "pill"], { errorMap: () => ({ message: "buttons must be rounded, square or pill" }) }).optional(),
    corners: z.enum(["rounded", "square"], { errorMap: () => ({ message: "corners must be rounded or square" }) }).optional(),
    footerNote: z.string({ invalid_type_error: "footerNote must be text" }).max(300, "footerNote can be up to 300 characters").optional(),
  })
  .strict();

export type EmailTheme = z.infer<typeof schema>;

/** The resolved look every email is drawn with. */
export type EmailLook = {
  page: string; card: string; border: string; ink: string; body: string; muted: string; footer: string;
  brand: string; buttonText: string; font: string;
  showLogo: boolean; logoAlign: "left" | "center"; buttonRadius: string; cardRadius: string; footerNote: string | null;
};

export const DEFAULT_LOOK: EmailLook = {
  page: "#eef2f8", card: "#ffffff", border: "#dfe6f0", ink: "#16243b", body: "#2b3a52", muted: "#6b7a90", footer: "#f6f8fc",
  brand: "#1e5fc2", buttonText: "#ffffff", font: EMAIL_FONTS.system,
  showLogo: true, logoAlign: "left", buttonRadius: "10px", cardRadius: "16px", footerNote: null,
};

export function resolveEmailLook(theme: EmailTheme | null | undefined): EmailLook {
  if (!theme) return DEFAULT_LOOK;
  const c = theme.colors ?? {};
  return {
    ...DEFAULT_LOOK,
    page: c.background ?? DEFAULT_LOOK.page,
    card: c.card ?? DEFAULT_LOOK.card,
    ink: c.heading ?? DEFAULT_LOOK.ink,
    body: c.text ?? DEFAULT_LOOK.body,
    brand: c.brand ?? DEFAULT_LOOK.brand,
    buttonText: c.buttonText ?? DEFAULT_LOOK.buttonText,
    font: EMAIL_FONTS[theme.font ?? "system"],
    showLogo: theme.logo?.show ?? true,
    logoAlign: theme.logo?.align ?? "left",
    buttonRadius: theme.buttons === "square" ? "0" : theme.buttons === "pill" ? "999px" : "10px",
    cardRadius: theme.corners === "square" ? "0" : "16px",
    footerNote: theme.footerNote?.trim() || null,
  };
}

/** Reads uploaded or pasted JSON: the theme, or plain-English problems to fix. */
export function parseEmailTheme(input: unknown): { theme: EmailTheme; errors: [] } | { theme: null; errors: string[] } {
  let value = input;
  if (typeof input === "string") {
    if (input.length > 20_000) return { theme: null, errors: ["The file is too big for an email template (20 KB at most)."] };
    try {
      value = JSON.parse(input);
    } catch {
      return { theme: null, errors: ["This isn't valid JSON. Start from the example file and change the values."] };
    }
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { theme: parsed.data, errors: [] };
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".");
    if (issue.code === "unrecognized_keys") return `${path ? `${path}: ` : ""}"${issue.keys.join('", "')}" isn't a template setting.`;
    if (issue.code === "invalid_type" && issue.received === "undefined") return `${path} is missing.`;
    if (issue.code === "invalid_type" && !issue.message.includes(" must ")) return `${path || "The template"} has the wrong kind of value.`;
    return issue.message;
  });
  return { theme: null, errors: [...new Set(errors)].slice(0, 8) };
}

/** Reads a stored theme, ignoring anything that no longer validates. */
export function readEmailTheme(value: unknown): EmailTheme | null {
  if (!value || typeof value !== "object") return null;
  const parsed = parseEmailTheme(value);
  return parsed.theme && Object.keys(parsed.theme).length ? parsed.theme : null;
}

/** The example file owners download and edit. */
export const EXAMPLE_EMAIL_THEME: EmailTheme = {
  version: 1,
  colors: { brand: "#1e5fc2", background: "#eef2f8", card: "#ffffff", heading: "#16243b", text: "#2b3a52", buttonText: "#ffffff" },
  font: "system",
  logo: { show: true, align: "left" },
  buttons: "rounded",
  corners: "rounded",
  footerNote: "",
};

/**
 * The built-in booking confirmation is its own HTML; when the business still
 * uses it unchanged, its header colour, page colour and font follow the theme.
 * Custom booking HTML is the owner's own design and is never touched.
 */
export function themeDefaultBookingHtml(html: string, defaultHtml: string, theme: EmailTheme | null | undefined): string {
  if (!theme || html !== defaultHtml) return html;
  const look = resolveEmailLook(theme);
  return html
    .replaceAll("#0b2a5b", look.brand)
    .replaceAll("background:#f1f5f9", `background:${look.page}`)
    .replace("font-family:Arial,Helvetica,sans-serif", `font-family:${look.font.replaceAll("'", "")}`);
}
