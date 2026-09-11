# BookedSecure Two-Rail Tenant Workspace

## Goal
Use the supplied dashboard only as structural inspiration: a slim BookedSecure rail, a tenant-owned navigation panel, and an attached main workspace. The redesign will organise BookedSecure’s real Assistant, bookings, leads, messaging, and settings rather than copying fleet content, charts, or 3D artwork.

## What the frame means for BookedSecure

```text
Desktop
┌──────────────┬──────────────────────────┬────────────────────────────────────┐
│ BookedSecure │ Current tenant           │ Current working page               │
│ global rail  │ identity + navigation    │ Assistant / bookings / leads / ... │
│              │ + contextual history     │                                    │
└──────────────┴──────────────────────────┴────────────────────────────────────┘

Mobile
┌─────────────────────────────────────────────────────────────────────────────┐
│ Compact header: tenant, page title, menu, notifications, account            │
├─────────────────────────────────────────────────────────────────────────────┤
│ Full-width current page; navigation and conversation history use drawers    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Slim outer BookedSecure rail
- Make BookedSecure the product-level anchor with its mark and compact icons.
- Keep only genuinely global utilities here: workspace/home access, notifications, account access, and the tenant-panel collapse control.
- Use tooltips and clear active states; the rail stays narrow rather than becoming another text menu.
- Do not place tenant operations or invented fleet-style features in this rail.

### 2. Tenant navigation panel
- Put the current tenant logo and tenant-derived business name at the top, in the role occupied by “REXUS” in the reference.
- Organise the verified BookedSecure destinations: Home, Bookings, Lead inbox, Quote page, Import data, Unfinished prospects, Business settings, Messaging, Automation, and Team access.
- Keep sections concise so everyday work appears before account configuration.
- Make the panel collapsible on desktop; collapsing it gives the main workspace more room while leaving a reliable way to reopen it.
- On the Home/Assistant screen, include persistent conversation access as contextual tenant content within this panel instead of creating an incoherent third full-height sidebar.

### 3. Attached main workspace
- Remove the detached/floating-page feeling: the current page begins directly beside the tenant panel and fills the remaining width.
- Preserve each page’s real purpose and data. The Home page remains Assistant-first, Bookings remains calendar/detail driven, and Lead inbox remains operational and scannable.
- On Home, keep the Assistant dominant with its account-backed conversation, proposal cards, approval actions, upload action, fixed composer, and compact live performance summary.
- Use the reference’s clean spacing, subtle dividers, crisp white surfaces, restrained status accents, and strong hierarchy—without importing its orange branding, decorative landscape, fleet data, or 3D scene.

### 4. Assistant-specific layout
- Remove the current duplicate rail effect caused by the shell navigation plus the Assistant’s separate conversation sidebar.
- Move New conversation, Clear chat, thread switching, and thread deletion into the contextual area of the tenant panel on Home.
- Keep the transcript as the main content plane and the composer fixed and fully visible at the bottom.
- Keep the compact “At a glance” summary secondary to the conversation and ensure Operational details still opens in its contained responsive dialog.
- Preserve all current Assistant behavior and tenant-scoped history; this is a presentation and information-architecture change only.

### 5. Responsive behaviour
- Desktop: both rails remain stable; the tenant panel can collapse without narrowing or overlapping the Assistant.
- Tablet: retain the BookedSecure rail where space allows and move the tenant panel into an overlay drawer.
- Mobile: use one compact header and separate drawers for navigation/history; the current page remains full width.
- Contain scrolling within the active page area, preserve safe-area spacing, and keep the Assistant composer visible when the keyboard opens.
- Verify that no menu, dialog, card, transcript, table, or control causes horizontal page movement.

## Visual system
- Keep the existing Outfit/Figtree typography and BookedSecure semantic palette.
- Use purple for identity and primary actions; turquoise, blue, and coral only for meaningful status accents.
- Use compact radii, quiet borders, and shallow shadows similar to the reference’s polished frame.
- Keep all tenant identity and customer-facing content data-driven and reusable for every business.

## Validation
- Test the redesigned shell on Home, Bookings, Lead inbox, Import, Unfinished prospects, and all settings pages.
- Verify active navigation, tenant identity, quote-page access, notifications, account controls, rail collapse, and mobile drawers.
- Verify conversation creation, switching, deletion, clearing, proposal approval, upload, scrolling, and the fixed composer.
- Check desktop, tablet, standard mobile, and short mobile sizes for overlap, clipping, inaccessible controls, and horizontal overflow.
- Confirm the preview is error-free and existing workflows/data behavior remain unchanged.

## Technical boundaries
- Frontend shell and presentation only; no database, AI logic, booking logic, messaging logic, permissions, or tenant data changes.
- Reuse the existing semantic design tokens and shared controls; do not embed the supplied screenshots as app assets.
- Preserve the existing tenant isolation and current live data queries.
