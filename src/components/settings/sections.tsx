import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  getSettings,
  saveAutomationRule,
  saveBusinessSettings,
  saveService,
} from "@/lib/app.functions";

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
  children,
}: {
  heading: string;
  description: string;
  children: (data: SettingsDataWithBusiness) => React.ReactNode;
}) {

  const { data, isLoading, error } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{heading}</h1>
        <p className="text-xs text-muted-foreground">{description}</p>
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
        },
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {textFields.map((key) => (
          <label key={key} className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{TEXT_FIELDS[key]}</span>
            <input
              disabled={readOnly}
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
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
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
            >
              <option value="simulated">Simulated (recorded, not sent)</option>
              <option value="twilio">Twilio (live SMS)</option>
              <option value="telnyx">Telnyx (live SMS)</option>
            </select>
          </label>
        )}
        {showQuietHours && (
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
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
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
                onChange={(event) => setForm({ ...form, quiet_hours_end: Number(event.target.value) })}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
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
    </section>
  );
}

export function ProviderStatus({
  provider,
}: {
  provider: { name: string; ok?: boolean; detail?: string } & Record<string, unknown>;
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Sending status</h2>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
  description: string | null;
  price_guidance: string | null;
  included_items: string | null;
  excluded_items: string | null;
  active: boolean;
};

export function ServicesEditor({ services, readOnly }: { services: Service[]; readOnly: boolean }) {
  const save = useServerFn(saveService);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);

  const mutation = useMutation({
    mutationFn: (service: Service) =>
      save({
        data: {
          id: service.id || null,
          name: service.name,
          description: service.description,
          price_guidance: service.price_guidance,
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
                description: "",
                price_guidance: "",
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

      <div className="mt-3 space-y-2">
        {services.length === 0 && (
          <p className="text-xs text-muted-foreground">No services added yet.</p>
        )}
        {services.map((service) => (
          <div key={service.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {service.name}{" "}
                {!service.active && <span className="text-xs text-muted-foreground">(inactive)</span>}
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
            <p className="mt-1 text-xs text-muted-foreground">{service.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Price guidance: {service.price_guidance || "not provided"}
            </p>
          </div>
        ))}
      </div>

      {editing && (
        <div className="mt-4 space-y-2 rounded-md border border-primary/30 bg-secondary/40 p-3">
          {(
            [
              ["name", "Name"],
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
              disabled={editing.name.length < 2 || mutation.isPending}
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
        Placeholders: {"{{first_name}}"}, {"{{business_name}}"}. Follow-ups stop automatically on reply
        or opt-out.
      </p>
      <div className="mt-3 space-y-3">
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">No follow-up steps configured yet.</p>
        )}
        {rules.map((rule) => {
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
                <span className="mb-1 block text-muted-foreground">Delay (minutes after previous)</span>
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
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">People with access</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        You are signed in as {role === "owner" ? "the business owner" : role.replace(/_/g, " ")}.
        Access is managed by the business owner.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {team.length === 0 && <li className="text-xs text-muted-foreground">No team members yet.</li>}
        {team.map((member) => (
          <li key={member.id} className="flex justify-between gap-3">
            <span>{member.name ?? member.email}</span>
            <span className="text-xs text-muted-foreground">
              {member.active ? "active" : "disabled"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
