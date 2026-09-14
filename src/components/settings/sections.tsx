import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { groupItems } from "@/lib/service-groups";
import { formatDuration } from "@/components/settings/availability";
import {
  getSettings,
  saveAutomationRule,
  saveBusinessSettings,
  saveQuotePageMode,
  saveService,
  saveServiceAddon,
  deleteServiceAddon,
} from "@/lib/app.functions";
import { QUOTE_MODES, QUOTE_MODE_LABELS, resolveQuoteMode, type QuoteMode } from "@/lib/quote-mode";
import { removeTeamMember, setTeamAccess } from "@/lib/team.functions";
import { useAuth } from "@/hooks/useAuth";
import { removeServiceImage, uploadServiceImage } from "@/lib/tenant-account.functions";
import { validateServiceImageUpload, type ServiceImageKind } from "@/lib/service-images";

/**
 * Shared settings building blocks. The underlying server functions and
 * permission rules are unchanged — these components only group the existing
 * controls into user-intent sections (business, messaging, automation, team).
 */

export type Business = {
  name: string;
  phone_number: string | null;
  service_area: string | null;
  opening_hours: string | null;
  sms_signature: string | null;
  privacy_policy_url: string | null;
  logo_url: string | null;
  timezone: string;
  automation_enabled: boolean;
  default_sms_provider: string;
  quiet_hours_start: number;
  quiet_hours_end: number;
};

export function useSettings() {
  const fetchSettings = useServerFn(getSettings);
  return useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
}

type SettingsData = NonNullable<ReturnType<typeof useSettings>["data"]>;
type SettingsDataWithBusiness = Omit<SettingsData, "business"> & {
  business: NonNullable<SettingsData["business"]>;
};

/** Renders the shared loading/error/empty states around a settings section. */
export function SettingsPageBody({
  heading,
  description,
  actions,
  children,
}: {
  heading: string;
  description: string;
  /** Optional header controls (e.g. dialog triggers), rendered opposite the heading. */
  actions?: (data: SettingsDataWithBusiness) => React.ReactNode;
  children: (data: SettingsDataWithBusiness) => React.ReactNode;
}) {
  const { data, isLoading, error } = useSettings();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-3 border-b border-border pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <h1 className="page-heading">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && data?.business ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {actions(data as SettingsDataWithBusiness)}
          </div>
        ) : null}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading settings…</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {!isLoading && !error && !data?.business && (
        <p className="text-sm text-muted-foreground">No business is linked to this account yet.</p>
      )}
      {data?.business ? children(data as SettingsDataWithBusiness) : null}
    </div>
  );
}

const TEXT_FIELDS = {
  name: "Business name",
  phone_number: "Sending number",
  service_area: "Service area / suburbs",
  opening_hours: "Opening hours",
  sms_signature: "SMS signature",
  privacy_policy_url: "Privacy policy URL",
  logo_url: "Logo URL (shown on your quote form)",
  timezone: "Timezone",
} as const;

type TextFieldKey = keyof typeof TEXT_FIELDS;

/**
 * Saves the business record. Every render receives the full current business,
 * so a partial section still submits a complete, unchanged-elsewhere payload.
 */
export function BusinessSettingsForm({
  business,
  readOnly,
  title,
  textFields = [],
  showProvider = false,
  showQuietHours = false,
  showAutomationSwitch = false,
  note,
}: {
  business: Business;
  readOnly: boolean;
  title: string;
  textFields?: readonly TextFieldKey[];
  showProvider?: boolean;
  showQuietHours?: boolean;
  showAutomationSwitch?: boolean;
  note?: string;
}) {
  const save = useServerFn(saveBusinessSettings);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: business.name,
    phone_number: business.phone_number ?? "",
    service_area: business.service_area ?? "",
    opening_hours: business.opening_hours ?? "",
    sms_signature: business.sms_signature ?? "",
    privacy_policy_url: business.privacy_policy_url ?? "",
    logo_url: business.logo_url ?? "",
    timezone: business.timezone,
    automation_enabled: business.automation_enabled,
    default_sms_provider: business.default_sms_provider as "simulated" | "twilio" | "telnyx",
    quiet_hours_start: business.quiet_hours_start,
    quiet_hours_end: business.quiet_hours_end,
  });

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          ...form,
          phone_number: form.phone_number || null,
          service_area: form.service_area || null,
          opening_hours: form.opening_hours || null,
          sms_signature: form.sms_signature || null,
          privacy_policy_url: form.privacy_policy_url || null,
          logo_url: form.logo_url || null,
        },
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">{title}</div>
      <div className="p-4">
        {note && <p className="mb-4 text-xs text-muted-foreground">{note}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {textFields.map((key) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{TEXT_FIELDS[key]}</span>
              <input
                disabled={readOnly}
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                className="form-control disabled:opacity-60"
              />
            </label>
          ))}
          {showProvider && (
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">SMS provider</span>
              <select
                disabled={readOnly}
                value={form.default_sms_provider}
                onChange={(event) =>
                  setForm({
                    ...form,
                    default_sms_provider: event.target.value as "simulated" | "twilio" | "telnyx",
                  })
                }
                className="form-control disabled:opacity-60"
              >
                <option value="simulated">Simulated (recorded, not sent)</option>
                <option value="twilio">Twilio (live SMS)</option>
                <option value="telnyx">Telnyx (live SMS)</option>
              </select>
            </label>
          )}
          {showQuietHours && (
            <label className="col-span-full flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={form.quiet_hours_start === form.quiet_hours_end}
                onChange={(event) =>
                  setForm({
                    ...form,
                    quiet_hours_start: event.target.checked ? 0 : 20,
                    quiet_hours_end: event.target.checked ? 0 : 8,
                  })
                }
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              <span>Send at any time (no quiet hours)</span>
            </label>
          )}
          {showQuietHours && form.quiet_hours_start !== form.quiet_hours_end && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Quiet hours start</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={readOnly}
                  value={form.quiet_hours_start}
                  onChange={(event) =>
                    setForm({ ...form, quiet_hours_start: Number(event.target.value) })
                  }
                  className="form-control disabled:opacity-60"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Quiet hours end</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={readOnly}
                  value={form.quiet_hours_end}
                  onChange={(event) =>
                    setForm({ ...form, quiet_hours_end: Number(event.target.value) })
                  }
                  className="form-control disabled:opacity-60"
                />
              </label>
            </div>
          )}
        </div>

        {showAutomationSwitch && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={form.automation_enabled}
              onChange={(event) => setForm({ ...form, automation_enabled: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>Automated acknowledgement and follow-up SMS enabled</span>
          </label>
        )}

        {!readOnly && (
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>
    </section>
  );
}

export function ProviderStatus({
  provider,
}: {
  provider: { name: string; ok?: boolean; detail?: string } & Record<string, unknown>;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">Sending status</div>
      <p className="m-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-md border border-border px-2 py-0.5 font-medium text-foreground">
          {provider.name === "simulated" ? "Simulated mode" : "Live sending"}
        </span>
        <span>
          Active provider: {provider.name}
          {typeof provider.detail === "string" ? ` · ${provider.detail}` : ""}
        </span>
      </p>
    </section>
  );
}

export type Service = {
  id: string;
  name: string;
  /** The owner's own grouping heading ("Interior", "Paint"), or null. */
  category?: string | null;
  /** Appointment length in minutes. Required for a service to be active/bookable. */
  duration_minutes: number | null;
  description: string | null;
  price_guidance: string | null;
  /** Whether a campaign discount may be highlighted for this service. */
  campaign_eligible: boolean;
  included_items: string | null;
  excluded_items: string | null;
  active: boolean;
  /** Public picture address shown on the customer card, or null. */
  image_url?: string | null;
};

/**
 * Picture attached to a service or extra. Shown on the customer's quote card;
 * owners can replace or remove it here. Purely visual — never used in texts.
 */
export function ServiceImageControl({
  kind,
  id,
  name,
  imageUrl,
  readOnly,
}: {
  kind: ServiceImageKind;
  id: string;
  name: string;
  imageUrl: string | null | undefined;
  readOnly: boolean;
}) {
  const upload = useServerFn(uploadServiceImage);
  const remove = useServerFn(removeServiceImage);
  const queryClient = useQueryClient();
  const inputId = `service-image-${kind}-${id}`;
  const done = () => queryClient.invalidateQueries({ queryKey: ["settings"] });

  const uploading = useMutation({
    mutationFn: async (file: File) => {
      const check = validateServiceImageUpload({ contentType: file.type, size: file.size });
      if (!check.ok) throw new Error(check.reason);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("That file could not be read."));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      return upload({ data: { kind, id, content_type: file.type, data_base64: base64 } });
    },
    onSuccess: () => {
      toast.success("Picture saved");
      done();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removing = useMutation({
    mutationFn: () => remove({ data: { kind, id } }),
    onSuccess: () => {
      toast.success("Picture removed");
      done();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const busy = uploading.isPending || removing.isPending;

  return (
    <div className="mb-2 flex items-center gap-2">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          className="h-12 w-16 shrink-0 rounded-md bg-secondary object-cover"
        />
      ) : (
        <span className="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
          No picture
        </span>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <label
            htmlFor={inputId}
            className={`cursor-pointer rounded-md border border-input px-2 py-1 ${busy ? "opacity-50" : "hover:bg-secondary"}`}
          >
            {busy ? "Saving…" : imageUrl ? "Replace" : "Add picture"}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) uploading.mutate(file);
            }}
          />
          {imageUrl && (
            <button
              type="button"
              onClick={() => removing.mutate()}
              disabled={busy}
              className="rounded-md border border-input px-2 py-1 text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DURATION_PRESETS = [60, 90, 120, 180, 240] as const;

/** A service is only active/bookable with a positive appointment duration. */
export function isValidDuration(value: number | null | undefined): boolean {
  return Number.isInteger(value) && Number(value) >= 15 && Number(value) <= 1440;
}

function DurationField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number) => void;
}) {
  const preset = DURATION_PRESETS.includes(Number(value) as never);
  const [custom, setCustom] = useState(!preset);
  return (
    <div className="text-xs">
      <span className="mb-1 block text-muted-foreground">
        Appointment duration <span className="text-destructive">*</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(minutes);
            }}
            className={`rounded-md border px-2.5 py-1.5 ${
              !custom && Number(value) === minutes
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-input text-muted-foreground hover:text-foreground"
            }`}
          >
            {formatDuration(minutes)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(true)}
          className={`rounded-md border px-2.5 py-1.5 ${
            custom
              ? "border-primary bg-primary/10 font-medium text-foreground"
              : "border-input text-muted-foreground hover:text-foreground"
          }`}
        >
          Custom
        </button>
      </div>
      {custom && (
        <label className="mt-1.5 block">
          <span className="text-muted-foreground">Minutes (15–1440)</span>
          <input
            type="number"
            min={15}
            max={1440}
            value={value ?? ""}
            onChange={(event) => onChange(Number(event.target.value))}
            className="mt-1 w-32 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </label>
      )}
      {!isValidDuration(value) && (
        <p className="mt-1 text-destructive">
          Set an appointment duration — a service cannot be active or bookable without one.
        </p>
      )}
    </div>
  );
}

export function ServicesEditor({ services, readOnly }: { services: Service[]; readOnly: boolean }) {
  const save = useServerFn(saveService);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);
  const groups = groupItems(services, (service) => service.category);

  const mutation = useMutation({
    mutationFn: (service: Service) =>
      save({
        data: {
          id: service.id || null,
          name: service.name,
          category: service.category?.trim() ? service.category.trim() : null,
          description: service.description,
          price_guidance: service.price_guidance,
          campaign_eligible: service.campaign_eligible !== false,
          duration_minutes: Number(service.duration_minutes ?? 0),
          included_items: service.included_items,
          excluded_items: service.excluded_items,
          active: service.active,
        },
      }),
    onSuccess: () => {
      toast.success("Service saved");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Approved services (AI may only use these)</h2>
        {!readOnly && (
          <button
            onClick={() =>
              setEditing({
                id: "",
                name: "",
                category: "",
                duration_minutes: 120,
                description: "",
                price_guidance: "",
                campaign_eligible: true,
                included_items: "",
                excluded_items: "",
                active: true,
              })
            }
            className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Add service
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Grouped exactly as your customers see them on your quote page.
      </p>

      <div className="mt-3 space-y-5">
        {services.length === 0 && (
          <p className="text-xs text-muted-foreground">No services added yet.</p>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.items.map((service) => (
                <div
                  key={service.id}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
                >
                  <ServiceImageControl
                    kind="service"
                    id={service.id}
                    name={service.name}
                    imageUrl={service.image_url}
                    readOnly={readOnly}
                  />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {service.name}{" "}
                      {!service.active && (
                        <span className="text-xs text-muted-foreground">(inactive)</span>
                      )}
                    </p>
                    {!readOnly && (
                      <button
                        onClick={() => setEditing(service)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-primary">
                    {service.price_guidance || "Price not set"}
                  </p>
                  {service.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {service.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {isValidDuration(service.duration_minutes) ? (
                      formatDuration(Number(service.duration_minutes))
                    ) : (
                      <span className="text-destructive">Duration not set — cannot be booked</span>
                    )}
                    {" · "}
                    {service.campaign_eligible !== false
                      ? "in campaign offers"
                      : "not in campaign offers"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="mt-4 space-y-2 rounded-md border border-primary/30 bg-secondary/40 p-3">
          {(
            [
              ["name", "Name"],
              ["category", "Group (e.g. Interior, Paint, Premium)"],
              ["price_guidance", "Price guidance"],
              ["description", "Description"],
              ["included_items", "What's included"],
              ["excluded_items", "What's not included"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{label}</span>
              <input
                value={editing[key] ?? ""}
                onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
          ))}
          <DurationField
            value={editing.duration_minutes}
            onChange={(minutes) => setEditing({ ...editing, duration_minutes: minutes })}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(event) => setEditing({ ...editing, active: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.campaign_eligible !== false}
              onChange={(event) =>
                setEditing({ ...editing, campaign_eligible: event.target.checked })
              }
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Include in campaign offers
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              Cancel
            </button>
            <button
              disabled={
                editing.name.length < 2 ||
                !isValidDuration(editing.duration_minutes) ||
                mutation.isPending
              }
              onClick={() => mutation.mutate(editing)}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Save service
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export type Rule = {
  id: string;
  rule_type: string;
  step: number;
  delay_minutes: number;
  message_template: string;
  active: boolean;
};

export function RulesEditor({ rules, readOnly }: { rules: Rule[]; readOnly: boolean }) {
  const save = useServerFn(saveAutomationRule);
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Rule>>({});
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visibleRules = needle
    ? rules.filter((rule) => {
        const draft = drafts[rule.id] ?? rule;
        return (
          `step ${rule.step}`.includes(needle) ||
          rule.rule_type.replace(/_/g, " ").includes(needle) ||
          draft.message_template.toLowerCase().includes(needle) ||
          `${draft.delay_minutes}`.includes(needle)
        );
      })
    : rules;

  const mutation = useMutation({
    mutationFn: (rule: Rule) =>
      save({
        data: {
          id: rule.id,
          delay_minutes: rule.delay_minutes,
          message_template: rule.message_template,
          active: rule.active,
        },
      }),
    onSuccess: () => {
      toast.success("Follow-up rule saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">SMS sequence</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Placeholders: {"{{first_name}}"}, {"{{business_name}}"}. Follow-ups stop automatically on
        reply or opt-out.
      </p>
      {rules.length > 0 && (
        <label className="mt-3 block">
          <span className="sr-only">Search follow-up steps</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search steps by number, type or wording…"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <div className="mt-3 space-y-3">
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">No follow-up steps configured yet.</p>
        )}
        {rules.length > 0 && visibleRules.length === 0 && (
          <p className="text-xs text-muted-foreground">No steps match “{search.trim()}”.</p>
        )}
        {visibleRules.map((rule) => {
          const draft = drafts[rule.id] ?? rule;
          return (
            <div key={rule.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium">
                  Step {rule.step} · {rule.rule_type.replace(/_/g, " ")}
                  {!rule.active && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      disabled — skipped by scheduler
                    </span>
                  )}
                </p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.active}
                    aria-label={`Step ${rule.step} enabled`}
                    disabled={readOnly || mutation.isPending}
                    onClick={() => {
                      const next = { ...draft, active: !draft.active };
                      setDrafts({ ...drafts, [rule.id]: next });
                      // Toggling persists immediately — no separate save needed.
                      mutation.mutate(next);
                    }}
                    className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                      draft.active ? "bg-primary" : "bg-input"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all ${
                        draft.active ? "left-4.5" : "left-0.5"
                      }`}
                    />
                  </button>
                  {draft.active ? "Enabled" : "Disabled"}
                </label>
              </div>

              <label className="mt-2 block text-xs">
                <span className="mb-1 block text-muted-foreground">
                  Delay (minutes after previous)
                </span>
                <input
                  type="number"
                  min={0}
                  disabled={readOnly}
                  value={draft.delay_minutes}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [rule.id]: { ...draft, delay_minutes: Number(event.target.value) },
                    })
                  }
                  className="w-40 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
                />
              </label>
              <textarea
                rows={3}
                disabled={readOnly}
                value={draft.message_template}
                onChange={(event) =>
                  setDrafts({
                    ...drafts,
                    [rule.id]: { ...draft, message_template: event.target.value },
                  })
                }
                className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
              />
              {!readOnly && (
                <button
                  onClick={() => mutation.mutate(draft)}
                  disabled={mutation.isPending}
                  className="mt-2 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Save step
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TeamList({
  team,
  role,
}: {
  team: { id: string; name: string | null; email: string | null; active: boolean | null }[];
  role: string;
}) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const setAccess = useServerFn(setTeamAccess);
  const remove = useServerFn(removeTeamMember);
  const canManage = role === "owner" || role === "platform_admin";
  const myId = session?.user.id ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["settings"] });
  const accessMutation = useMutation({
    mutationFn: (input: { profileId: string; active: boolean }) => setAccess({ data: input }),
    onSuccess: async (result) => {
      toast.success(`${result.name}: access ${accessMutation.variables?.active ? "restored" : "removed"}`);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (profileId: string) => remove({ data: { profileId } }),
    onSuccess: async (result) => {
      toast.success(`${result.name} deleted from your team`);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const busy = accessMutation.isPending || deleteMutation.isPending;

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">People with access</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        You are signed in as {role === "owner" ? "the business owner" : role.replace(/_/g, " ")}.
        {canManage
          ? " Removing access keeps the person on the list but blocks sign-in; deleting removes them completely."
          : " Access is managed by the business owner."}
      </p>
      <ul className="mt-3 divide-y divide-border text-sm">
        {team.length === 0 && (
          <li className="py-1 text-xs text-muted-foreground">No team members yet.</li>
        )}
        {team.map((member) => {
          const isMe = member.id === myId;
          return (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate">
                  {member.name ?? member.email}
                  {isMe && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                </div>
                {member.name && member.email && (
                  <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    member.active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-secondary text-muted-foreground"
                  }`}
                >
                  {member.active ? "Active" : "Access removed"}
                </span>
                {canManage && !isMe && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        accessMutation.mutate({ profileId: member.id, active: !member.active })
                      }
                      className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      {member.active ? "Remove access" : "Restore access"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const who = member.name ?? member.email ?? "this person";
                        if (
                          window.confirm(
                            `Delete ${who} from your team? Their sign-in is removed permanently. Leads and bookings are kept.`,
                          )
                        ) {
                          deleteMutation.mutate(member.id);
                        }
                      }}
                      className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Quote page settings. Switching mode changes only what the public page renders;
 * the manual form, its SMS behaviour and the AI conversation are separate paths
 * and neither is altered by the other.
 */
export function QuotePageModeCard({
  quoteMode,
  slug,
  readOnly,
}: {
  quoteMode: string | null;
  slug: string | null;
  readOnly: boolean;
}) {
  const save = useServerFn(saveQuotePageMode);
  const queryClient = useQueryClient();
  const current = resolveQuoteMode(quoteMode);
  const [selected, setSelected] = useState<QuoteMode>(current);

  const mutation = useMutation({
    mutationFn: (mode: QuoteMode) => save({ data: { quote_mode: mode } }),
    onSuccess: async () => {
      toast.success("Quote page mode updated");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Quote page</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose what customers see at {slug ? `/quote/${slug}` : "your public quote link"}.
      </p>

      <div className="mt-4 space-y-2">
        {QUOTE_MODES.map((mode) => (
          <label
            key={mode}
            className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${
              selected === mode ? "border-primary" : "border-input"
            }`}
          >
            <input
              type="radio"
              name="quote-mode"
              value={mode}
              checked={selected === mode}
              disabled={readOnly}
              onChange={() => setSelected(mode)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              <span className="block font-medium">{QUOTE_MODE_LABELS[mode]}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {mode === "manual_sms"
                  ? "The current step-by-step form. Behaviour is unchanged, including SMS acknowledgement when it is switched on."
                  : "A guided chat that explains your listed services and collects details. No SMS is sent from this conversation, and no price or booking is ever confirmed."}
              </span>
            </span>
          </label>
        ))}
      </div>

      {!readOnly && (
        <button
          disabled={selected === current || mutation.isPending}
          onClick={() => mutation.mutate(selected)}
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving…" : "Save quote page mode"}
        </button>
      )}
      {readOnly && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only the business owner can change this.
        </p>
      )}
    </section>
  );
}


export type AddonDraft = {
  id: string;
  name: string;
  category?: string | null;
  description: string | null;
  price_guidance: string | null;
  duration_minutes: number | null;
  active: boolean;
  serviceIds: string[];
  image_url?: string | null;
};

/**
 * Add-on extras. Each add-on belongs to this business and must be linked to at
 * least one of its approved services, so the assistant can only ever offer an
 * extra alongside a service the owner approved.
 */
export function AddonsEditor({
  addons,
  services,
  readOnly,
}: {
  addons: AddonDraft[];
  services: { id: string; name: string }[];
  readOnly: boolean;
}) {
  const save = useServerFn(saveServiceAddon);
  const remove = useServerFn(deleteServiceAddon);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AddonDraft | null>(null);

  const mutation = useMutation({
    mutationFn: (addon: AddonDraft) =>
      save({
        data: {
          id: addon.id || null,
          name: addon.name,
          category: addon.category?.trim() ? addon.category.trim() : null,
          description: addon.description,
          price_guidance: addon.price_guidance,
          duration_minutes: addon.duration_minutes,
          active: addon.active,
          service_ids: addon.serviceIds,
        },
      }),
    onSuccess: () => {
      toast.success("Add-on saved");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removal = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Add-on removed");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const serviceName = (id: string) => services.find((service) => service.id === id)?.name ?? "—";

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Add-on extras</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Extras customers can add to a service. One extra can sit under several services.
          </p>
        </div>
        {!readOnly && services.length > 0 && (
          <button
            onClick={() =>
              setEditing({
                id: "",
                name: "",
                category: "",
                description: "",
                price_guidance: "",
                duration_minutes: null,
                active: true,
                serviceIds: [],
              })
            }
            className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Add extra
          </button>
        )}
      </div>

      {services.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">Add a service first, then extras for it.</p>
      )}

      <div className="mt-3 space-y-5">
        {services.length > 0 && addons.length === 0 && (
          <p className="text-xs text-muted-foreground">No extras added yet.</p>
        )}
        {groupItems(addons, (addon) => addon.category).map((group) => (
          <div key={group.label}>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.items.map((addon) => (
                <div
                  key={addon.id}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {addon.name}{" "}
                      {!addon.active && (
                        <span className="text-xs text-muted-foreground">(inactive)</span>
                      )}
                    </p>
                    {!readOnly && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditing({ ...addon })}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removal.mutate(addon.id)}
                          disabled={removal.isPending}
                          className="text-xs text-destructive"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <ServiceImageControl
                    kind="addon"
                    id={addon.id}
                    name={addon.name}
                    imageUrl={addon.image_url}
                    readOnly={readOnly}
                  />
                  <p className="mt-1 text-sm font-semibold text-primary">
                    {addon.price_guidance || "Price not set"}
                    {addon.duration_minutes ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {` · adds ${formatDuration(addon.duration_minutes)}`}
                      </span>
                    ) : null}
                  </p>
                  {addon.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {addon.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Offered with: {addon.serviceIds.map(serviceName).join(", ") || "no service yet"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="mt-4 space-y-2 rounded-md border border-primary/30 bg-secondary/40 p-3">
          {(
            [
              ["name", "Name"],
              ["category", "Group (optional)"],
              ["price_guidance", "Price"],
              ["description", "Description"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{label}</span>
              <input
                value={editing[key] ?? ""}
                onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
          ))}
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Extra time in minutes (optional)</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={editing.duration_minutes ?? ""}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  duration_minutes: event.target.value ? Number(event.target.value) : null,
                })
              }
              className="w-32 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
          </label>
          <fieldset className="text-xs">
            <legend className="mb-1 text-muted-foreground">
              Offer this extra with <span className="text-destructive">*</span>
            </legend>
            <div className="space-y-1">
              {services.map((service) => (
                <label key={service.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.serviceIds.includes(service.id)}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        serviceIds: event.target.checked
                          ? [...editing.serviceIds, service.id]
                          : editing.serviceIds.filter((id) => id !== service.id),
                      })
                    }
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  {service.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(event) => setEditing({ ...editing, active: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Active
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              Cancel
            </button>
            <button
              disabled={
                editing.name.trim().length < 2 ||
                editing.serviceIds.length === 0 ||
                mutation.isPending
              }
              onClick={() => mutation.mutate(editing)}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Save add-on
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
