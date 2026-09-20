import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getBusinessIdentity,
  saveBusinessIdentityDetails,
} from "@/lib/tenant-identity.functions";
import {
  AU_STATES,
  MESSAGE_TYPE_OPTIONS,
  describeMissingIdentityFields,
  formatAbn,
  missingIdentityFields,
  type BusinessIdentity,
} from "@/lib/tenant-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Owner-facing business details required before a dedicated number is issued.
 * Kept plain and short: the details a phone company would ask for, nothing else.
 */
export function BusinessIdentityPanel({ readOnly }: { readOnly?: boolean }) {
  const load = useServerFn(getBusinessIdentity);
  const save = useServerFn(saveBusinessIdentityDetails);
  const queryClient = useQueryClient();

  const record = useQuery({
    queryKey: ["business-identity"],
    queryFn: () => load({ data: undefined }),
  });

  const [form, setForm] = useState<BusinessIdentity | null>(null);
  const [declared, setDeclared] = useState(false);

  useEffect(() => {
    if (!record.data) return;
    setForm(record.data.identity);
    setDeclared(Boolean(record.data.identity.declarationAcceptedAt));
  }, [record.data]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Nothing to save yet.");
      return save({
        data: {
          legal_name: form.legalName,
          trading_name: form.tradingName,
          abn: form.abn,
          address_line1: form.addressLine1,
          address_line2: form.addressLine2,
          suburb: form.suburb,
          state: form.state,
          postcode: form.postcode,
          website: form.website,
          contact_name: form.contactName,
          contact_email: form.contactEmail,
          contact_phone: form.contactPhone,
          message_types: form.messageTypes,
          declaration_accepted: declared,
        },
      });
    },
    onSuccess: (result) => {
      if (result.missing.length > 0) {
        toast.warning(`Saved. Still needed: ${describeMissingIdentityFields(result.missing)}.`);
      } else {
        toast.success("Your business details are saved. You can claim a number now.");
      }
      void queryClient.invalidateQueries({ queryKey: ["business-identity"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (record.isLoading || !form) {
    return (
      <section className="panel overflow-hidden" id="business-identity">
        <div className="section-heading">Your business details</div>
        <p className="p-4 text-sm text-muted-foreground">Loading your details…</p>
      </section>
    );
  }

  const missing = missingIdentityFields({
    ...form,
    declarationAcceptedAt: declared ? (form.declarationAcceptedAt ?? "pending") : null,
  });
  const complete = missing.length === 0;

  const set = (patch: Partial<BusinessIdentity>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const toggleMessageType = (option: string) =>
    set({
      messageTypes: form.messageTypes.includes(option)
        ? form.messageTypes.filter((item) => item !== option)
        : [...form.messageTypes, option],
    });

  return (
    <section className="panel overflow-hidden" id="business-identity">
      <div className="section-heading">Your business details</div>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          These are the details recorded against your dedicated number, the same way a phone
          company records who a number belongs to. They are kept private and are only ever produced
          if an authority asks who owns the number.
        </p>

        {complete ? (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            Your details are complete{form.updatedAt ? "" : ""}. nothing else is needed here.
          </p>
        ) : (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Still needed before a number can be issued:{" "}
            {describeMissingIdentityFields(missing)}.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registered business name" required>
            <Input
              value={form.legalName}
              disabled={readOnly}
              onChange={(event) => set({ legalName: event.target.value })}
              placeholder="Business Pty Ltd"
            />
          </Field>
          <Field label="Trading name (if different)">
            <Input
              value={form.tradingName ?? ""}
              disabled={readOnly}
              onChange={(event) => set({ tradingName: event.target.value })}
            />
          </Field>
          <Field label="ABN" required>
            <Input
              value={form.abn}
              disabled={readOnly}
              inputMode="numeric"
              onChange={(event) => set({ abn: event.target.value })}
              onBlur={(event) => set({ abn: formatAbn(event.target.value) })}
              placeholder="11 digits"
            />
          </Field>
          <Field label="Website">
            <Input
              value={form.website ?? ""}
              disabled={readOnly}
              onChange={(event) => set({ website: event.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field label="Street address" required>
            <Input
              value={form.addressLine1}
              disabled={readOnly}
              onChange={(event) => set({ addressLine1: event.target.value })}
            />
          </Field>
          <Field label="Unit / level (optional)">
            <Input
              value={form.addressLine2 ?? ""}
              disabled={readOnly}
              onChange={(event) => set({ addressLine2: event.target.value })}
            />
          </Field>
          <Field label="Suburb" required>
            <Input
              value={form.suburb}
              disabled={readOnly}
              onChange={(event) => set({ suburb: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" required>
              <Select
                value={form.state}
                disabled={Boolean(readOnly)}
                onValueChange={(value) => set({ state: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick" />
                </SelectTrigger>
                <SelectContent>
                  {AU_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Postcode" required>
              <Input
                value={form.postcode}
                disabled={readOnly}
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => set({ postcode: event.target.value.replace(/\D/g, "") })}
              />
            </Field>
          </div>
          <Field label="Contact name" required>
            <Input
              value={form.contactName}
              disabled={readOnly}
              onChange={(event) => set({ contactName: event.target.value })}
            />
          </Field>
          <Field label="Contact email" required>
            <Input
              value={form.contactEmail}
              disabled={readOnly}
              inputMode="email"
              onChange={(event) => set({ contactEmail: event.target.value })}
            />
          </Field>
          <Field label="Contact mobile" required>
            <Input
              value={form.contactPhone}
              disabled={readOnly}
              inputMode="tel"
              onChange={(event) => set({ contactPhone: event.target.value })}
            />
          </Field>
        </div>

        <div className="space-y-2">
          <Label>What will you use the number for?</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {MESSAGE_TYPE_OPTIONS.map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={form.messageTypes.includes(option)}
                  disabled={readOnly}
                  onCheckedChange={() => toggleMessageType(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={declared}
            disabled={readOnly}
            onCheckedChange={(value) => setDeclared(value === true)}
          />
          <span>
            I confirm these details are true and that this business is responsible for the messages
            sent from its number.
          </span>
        </label>

        {!readOnly && (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save my business details"}
          </Button>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-muted-foreground"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
