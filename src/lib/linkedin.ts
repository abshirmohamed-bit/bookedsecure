/**
 * Pure helpers for posting to LinkedIn through LinkedIn's official API.
 *
 * Profile posts use "Share on LinkedIn" (w_member_social, self-serve). Company
 * Page posts use the Community Management API (w_organization_social), which
 * LinkedIn has to approve first; it is switched on with LINKEDIN_PAGES_ENABLED.
 * LinkedIn offers no public API for direct messages, so there is none here.
 */

export const LINKEDIN_CALLBACK_PATH = "/api/public/linkedin/oauth/callback";
export const LINKEDIN_POST_MAX = 3000;

export const PROFILE_SCOPES = ["openid", "profile", "w_member_social"] as const;
export const PAGE_SCOPES = ["r_organization_admin", "w_organization_social"] as const;

/** Page roles LinkedIn lets post as the organization. */
export const POSTING_ROLES = new Set(["ADMINISTRATOR", "CONTENT_ADMIN", "DIRECT_SPONSORED_CONTENT_POSTER"]);

export type LinkedInAuthor = { urn: string; name: string; kind: "person" | "organization" };

export function linkedInScopes(pagesEnabled: boolean): string[] {
  return pagesEnabled ? [...PROFILE_SCOPES, ...PAGE_SCOPES] : [...PROFILE_SCOPES];
}

export function buildLinkedInAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; scopes: string[] }): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.scopes.join(" "));
  return url.toString();
}

/**
 * LinkedIn post text uses its "little text" format, where these characters
 * have meaning (mentions, hashtags, links) and must be escaped to show as typed.
 * Hashtags (#word) are kept so they still work as hashtags.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`).replace(/#(?![\p{L}\p{N}_])/gu, "\\#");
}

/** Trimmed text, or the reason it can't be posted. */
export function postTextProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Write something to post.";
  if (trimmed.length > LINKEDIN_POST_MAX) return `LinkedIn posts can be at most ${LINKEDIN_POST_MAX} characters (this one is ${trimmed.length}).`;
  return null;
}

/** Request body for POST https://api.linkedin.com/rest/posts (a public text post). */
export function buildPostBody(authorUrn: string, text: string, content?: Record<string, unknown> | null) {
  return {
    author: authorUrn,
    commentary: escapeLittleText(text.trim()),
    ...(content ? { content } : {}),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

/** Public address of a published post, e.g. https://www.linkedin.com/feed/update/urn:li:share:123/ */
export function linkedInPostUrl(postUrn: string | null | undefined): string | null {
  if (!postUrn || !/^urn:li:(share|ugcPost|activity):\d+$/.test(postUrn)) return null;
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}

export function personUrn(sub: string): string {
  return `urn:li:person:${sub}`;
}

export function organizationUrn(id: string | number): string {
  return `urn:li:organization:${id}`;
}

/** Organization ids from an organizationAcls response where the member may post. */
export function postableOrganizationIds(elements: { organization?: string | undefined; role?: string | undefined; state?: string | undefined }[]): string[] {
  const ids = new Set<string>();
  for (const e of elements) {
    const id = e.organization?.match(/^urn:li:organization:(\d+)$/)?.[1];
    if (id && e.role && POSTING_ROLES.has(e.role) && (e.state ?? "APPROVED") === "APPROVED") ids.add(id);
  }
  return [...ids];
}

/** Every author the business can post as: the owner's profile first, then their Pages. */
export function availableAuthors(account: { member_urn: string; member_name: string | null; organizations: { id: string; name: string }[] }): LinkedInAuthor[] {
  return [
    { urn: account.member_urn, name: account.member_name ?? "Your profile", kind: "person" as const },
    ...account.organizations.map((o) => ({ urn: organizationUrn(o.id), name: o.name, kind: "organization" as const })),
  ];
}

/** Days until the connection must be renewed (LinkedIn tokens last about 60 days). */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}
