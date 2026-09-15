# Vertical Expansion Assessment: From Auto Detailing to General Sole-Trader Platform

## Executive Summary

Yes. BookedSecure can support lawn mowing, cleaning, plumbing, and most other Australian sole-trader/service businesses without rebuilding the core product. The architecture is already vertical-agnostic: tenant-scoped businesses, services, add-ons, bookings, leads, SMS, campaigns, Cowork AI, billing, and team management work the same regardless of trade.

The remaining 10–20% that is currently "auto-detailing-shaped" is mostly **language and defaults** in the marketing pages, quote flow labels, AI prompts, and a few hardcoded vehicle references. None of it is a structural blocker.

## What Is Already Vertical-Agnostic

- **Tenant model**: every business has its own `business_id`, isolated data, RLS, subscription, credits, and phone number.
- **Service catalogue**: services, groups, add-ons, prices, durations, images, and conditional add-on linking are all tenant-defined. The onboarding scraper is explicitly tenant-neutral.
- **Quote/booking flow**: pick service → choose add-ons → collect details → consent → time selection → booking is generic service-business logic.
- **Messaging & campaigns**: SMS, opt-outs, quiet hours, follow-ups, and reactivation campaigns are industry-blind.
- **Billing**: subscriptions, credit packs, top-ups, Stripe, and the Glocast promo are all generic pricing plumbing.
- **Cowork AI**: tools are mostly operational (leads, bookings, settings, team, CSV) and not tied to detailing.

## What Currently Assumes Auto Detailing

The platform contains ~79 direct references to detailing/vehicle concepts in the key source paths. These fall into four buckets:

### 1. Public marketing & authentication copy
- `/` (HomeLanding): "Australian detailers", "Stop losing detailing enquiries", audience list targets detailing studios.
- `/home`, `/pricing`, `/auth`, `/privacy`: titles, descriptions, and feature wording mention "detailing enquiries" and "vehicle details".
- `/quote` index: "Choose your detailer's enquiry link".

### 2. Quote/customer-facing labels
- `src/routes/quote.$slug.tsx`: step labels "Vehicle" and "Condition"; field label "What type of vehicle is it?"; placeholder text referencing "interior, exterior, stains, odour, paint, pet hair".
- `src/lib/domain.ts`: hardcoded `VEHICLE_TYPES` (Small car, Sedan, SUV, etc.).
- `src/lib/web-chat.ts`: step names, welcome text, and prompts mention "vehicle details".

### 3. Lead record field
- `leads.vehicle_type` column is used in quote flow, lead detail view, and Assistant context. For non-vehicle trades this would hold the equivalent detail (e.g., property size, lawn area, appliance type).

### 4. Hero image
- `src/assets/detail-hero.jpg` is a detailing-specific photo.

## Compatible Business Types

BookedSecure fits any service business where the customer journey is: *enquiry → describe the job → get a quote/price guidance → book a time → receive SMS updates*. Strong fits include:

- Lawn mowing & garden care
- House cleaning / carpet cleaning / window cleaning
- Mobile car wash / mechanic / tyre services (already adjacent)
- Plumbing / electrical / HVAC / pest control
- Handyman / property maintenance
- Appliance repair
- Mobile pet grooming
- Pool maintenance
- Pressure washing
- Small trades and owner-operators generally

Poor fits (would need bigger changes):
- E-commerce / product sales (no service catalogue concept)
- Multi-location retail with walk-in queues
- Subscription-box or SaaS businesses

## Recommended Rebrand Workstreams

### Workstream A: Tenant-configurable quote labels (high impact, low effort)
- Replace the hardcoded "vehicle" step/label with a tenant-configurable field.
- Introduce a `quote_subject_label` and `quote_subject_options` on the business/tenant settings.
- Default options become neutral (e.g., "Service area / item size") rather than vehicle types.
- Update `VEHICLE_TYPES` to become `QUOTE_SUBJECT_OPTIONS` or pull from tenant config.
- Keep `leads.vehicle_type` as a generic metadata column; rename display label only.

### Workstream B: Rebrand public pages (medium effort)
- Rewrite `HomeLanding.tsx` audience, hero copy, and "Who it's for" section to speak to sole traders generally.
- Update `/home`, `/pricing`, `/auth`, `/privacy`, and `/quote` index meta + body copy.
- Replace `detail-hero.jpg` with a neutral service-business hero image.
- Keep plan names/prices and product mechanics untouched.

### Workstream C: AI prompt neutrality (low effort)
- Replace "vehicle" wording in `src/lib/web-chat.ts` welcome and step prompts with generic terms derived from tenant config.
- Update Cowork system prompts and tool descriptions to use "job", "service", or tenant-specific labels.

### Workstream D: Onboarding and settings (low effort)
- Make the website scraper group headings and service names land correctly for any trade (already tenant-neutral).
- Add a "Business type / industry" field during signup that pre-seeds suggested quote labels.
- Update settings page descriptions to remove "detailing".

### Workstream E: Lead/job terminology (low effort)
- Change display labels from "Vehicle" to the configured subject label in `leads.$leadId.tsx`, booking panels, and calendar detail.
- Update route head descriptions company-wide.

## Suggested Phasing

**Phase 1 — Label neutrality (1 cycle)**
- Tenant-configurable quote subject label and options.
- Rename all customer-facing "vehicle" labels to the configured term.
- Update AI prompts to use the configured term.

**Phase 2 — Marketing rebrand (1 cycle)**
- Rewrite public pages for sole-trader positioning.
- Swap hero image.
- Update auth and privacy copy.

**Phase 3 — Onboarding polish (1 cycle)**
- Add business-type selector.
- Pre-seed quote labels by industry.
- Validate scraper output for a lawn-mowing and cleaning example.

## What Does NOT Need to Change

- Database schema (services, leads, bookings, messages, credits, subscriptions)
- RLS and tenant isolation
- Stripe billing and credit-pack plumbing
- SMS provider integration and quiet-hours logic
- Follow-up sequences and reactivation campaigns
- Team/role model
- Cowork tool structure (only wording)

## Recommendation

The fastest path to a general sole-trader platform is **Phase 1 + Phase 2**: make the quote subject label tenant-configurable, and rewrite the public marketing copy. That unlocks lawn mowing, cleaning, and trades almost immediately without touching the data model or billing.

The risk is low because every change is copy/label-level; the underlying booking, SMS, and billing engine is already generic.
