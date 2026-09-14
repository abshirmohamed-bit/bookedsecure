# Tenant home: compact product discovery with full Cowork

## What will change

Rebuild `/dashboard` around the selected reference while preserving BookedSecure’s current navigation and visual system.

```text
┌──────────────────────────────────────────────────────────────┐
│ Trending tools & products — compact horizontal card row      │
├─────────────────────────────────────────────┬────────────────┤
│                                             │ At a glance    │
│ Full Cowork conversation                    │ Operational    │
│ and pinned message box                      │ details        │
│                                             │ (same place)   │
└─────────────────────────────────────────────┴────────────────┘
```

- Add a compact **Trending tools & products** strip above Cowork, inspired by the reference but with materially smaller cards and images so more products remain visible.
- Each product card will show its image, brand, product name, short category/use, price or offer when available, and a clear external action. Affiliate links will be visibly disclosed.
- Remove the circled social-update/feed item entirely. This will not become a social feed or posting system.
- Let **Cowork occupy the full main section beneath the product row**, retaining its real conversation history, file attachment, action cards, confirmations, and keyboard-safe pinned Send control.
- Keep the existing **At a glance / Operational details** container in its current upper-right position and preserve its existing dialog and data.
- Keep the product strip secondary to tenant work: compact on desktop, horizontally scrollable on mobile, and never allowed to push Cowork’s Send button below the visible screen.

## Product and affiliate foundation

- Add a tenant-neutral curated product catalogue rather than hardcoding Glocast-specific products.
- Store product image, brand, title, category, destination URL, affiliate disclosure, price/offer label, active state, and display order.
- Show only active products; open external destinations safely in a new tab.
- Record privacy-safe product impressions and outbound clicks with the signed-in tenant so affiliate performance can be measured later.
- Start with honest empty/loading states when no products are configured; do not invent affiliate relationships, commissions, prices, or product claims.

## Layout behaviour

- Desktop: compact product rail across the top; Cowork remains the dominant content area; Operational Details stays pinned at the upper right.
- Tablet/mobile: product cards become a short swipe row; Operational Details remains compact; Cowork receives the remaining visible height with no sideways page movement.
- Existing conversation-history rail and tenant navigation stay unchanged.
- The dedicated `/assistant` conversation routes keep their focused chat layout; the marketplace treatment applies to the tenant home at `/dashboard`.

## Technical notes

- Split the current shared workspace presentation so `/dashboard` can render the discovery row while `/assistant` and `/assistant/:threadId` continue using the focused Assistant workspace.
- Build reusable compact product-card and discovery-row components using the existing semantic design tokens and Button component.
- Add tenant-safe catalogue reads and click analytics in Lovable Cloud. Catalogue management is not part of this visual change; products can initially be maintained centrally.
- Preserve all existing Cowork and Operational Details server functions and business logic.
- Keep `/dashboard` metadata specific to the tenant home.

## Verification

- Verify desktop and mobile layouts against the selected reference, including compact card density and removal of the circled feed item.
- Confirm Cowork can send, retain, refresh, attach a CSV, and render action cards from the redesigned home.
- Confirm Operational Details opens and closes from the same position with unchanged metrics.
- Confirm product links, affiliate disclosure, event recording, keyboard-open behavior, no horizontal overflow, and reduced-motion behavior.
- Run focused tests, type checks, and the preview build before completion.