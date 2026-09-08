# BookedSecure Dashboard UX/UI Redesign

## Goal
Redesign the authenticated BookedSecure dashboard as a bright, compact lead-operations workspace inspired by GuardFlow’s structure and Connecteam’s clarity—without copying either product or changing BookedSecure’s workflows.

The interface will remain tenant-neutral and reusable for every current and future business.

## Locked visual direction
- **Palette:** `#A05AFF` primary purple, `#1BCFB4` turquoise, `#4BCBEB` malibu blue, `#FE9496` coral, and `#9E58FF` lilac, balanced with white and pale grey-blue neutrals.
- **Typography:** Outfit for headings and Figtree for interface/body text.
- **Layout:** compact command centre with a persistent left operations rail, slim top command bar, concise metrics, and the lead inbox as the dominant workspace.
- **Style:** light, crisp, colourful, information-dense, and professional. Purple will identify the brand and primary actions rather than dominate every surface.
- **Reference usage:** the supplied GuardFlow screenshot informs hierarchy, spacing, navigation, and density only; it will not be embedded or copied as an asset.

## What will change

### 1. Shared visual system
- Replace the current dark charcoal/green dashboard theme with semantic light-theme tokens for backgrounds, panels, borders, text, actions, status colours, and focus states.
- Load Outfit and Figtree correctly and apply them consistently.
- Standardise compact controls, badges, panels, tables, and button states around the new palette.
- Preserve accessible contrast, keyboard focus, and reduced-motion behaviour.

### 2. Dashboard shell
- Replace the current horizontal-only navigation with a GuardFlow-style desktop left rail.
- Organise real BookedSecure destinations: Leads, Analytics, Quote page, Import data, Business settings, Messaging, Automation, and Team access.
- Keep tenant logo/name, notifications, quote-page access, account controls, and breadcrumbs.
- Use a compact top command bar for page context and utility controls.
- On smaller screens, collapse the rail into a usable mobile navigation rather than shrinking the desktop layout.

### 3. Leads command centre
- Keep the actual heading and description: **Leads** and “Enquiries that need a reply, follow-up status and completed jobs.”
- Restyle the six existing metrics without inventing new measurements:
  - Total leads
  - Median response and within-five-minute rate
  - Reply rate
  - Completed jobs
  - Completed revenue
  - Needs follow-up, opt-outs, and failures
- Give each metric a clear semantic accent and compact hierarchy while keeping the current values and calculations unchanged.

### 4. Reactivation and follow-up area
- Reframe “Win back dormant leads” as a compact operational panel with contact count, approval-gated campaign drafting, and the existing safety explanation.
- Keep “Run due follow-ups” visible as a distinct operational action.
- Do not alter campaign approval, consent, quiet-hours, sending, or tenant-isolation logic.

### 5. Lead inbox
- Reorganise source, SMS delivery, and status filters into a compact toolbar.
- Keep Deleted leads, Add lead, selection, deletion, retry, and pagination behaviour intact.
- Restyle the existing table around BookedSecure’s real columns: Source, Customer, Mobile, Service interest, Status, Last activity, and Revenue.
- Improve scanning with clearer customer hierarchy, concise status treatments, stable column widths, subtle row interaction, and a responsive mobile presentation.
- Preserve all live data, filtering, pagination, selection, and links to lead conversations.

## Validation
- Compare the finished desktop screen against the supplied GuardFlow reference for hierarchy and density, not content.
- Test the authenticated Leads workspace at desktop, tablet, and mobile sizes for overflow, clipped labels, navigation usability, and readable rows.
- Verify filters, quote-page controls, campaign drafting, due follow-ups, add/delete lead controls, pagination, and lead navigation still work.
- Run focused interface tests and confirm the preview is error-free.

## Technical boundaries
- Presentation-only redesign: no database, booking, messaging, campaign, or AI behaviour changes.
- Reuse semantic design tokens and existing shared controls; no hardcoded visual colours in page components.
- Keep all content tenant-derived and all fixes universal for future tenants.
