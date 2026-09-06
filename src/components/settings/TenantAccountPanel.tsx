import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TenantMark } from "@/components/TenantMark";
import {
  getTenantAccount,
  removeTenantLogo,
  saveOwnerNotification,
  uploadTenantLogo,
} from "@/lib/tenant-account.functions";
import {
  formatOwnerNotificationNumber,
  isValidOwnerNotificationNumber,
  validateOwnerNotificationNumber,
} from "@/lib/owner-phone";
import {
  ALLOWED_LOGO_TYPES,
  MAX_LOGO_BYTES,
  MAX_LOGO_PIXELS,
  validateLogoUpload,
} from "@/lib/tenant-logo";

/**
 * Tenant account settings. Two owner-managed values live here:
 *  - the owner notification number (where owner booking alerts are texted), and
 *  - the business logo (visual branding only, never used in SMS).
 *
 * The assigned SMS sending line and the public callback number are shown for
 * clarity but are managed elsewhere, so the four values can never be confused.
 */
export function TenantAccountPanel() {
  const fetchAccount = useServerFn(getTenantAccount);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-account"],
    queryFn: () => fetchAccount(),
  });

  const persistPhone = useServerFn(saveOwnerNotification);
  const persistLogo = useServerFn(uploadTenantLogo);
  const dropLogo = useServerFn(removeTenantLogo);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; base64: string; type: string } | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    setName(data.ownerNotificationName ?? "");
    setPhone(formatOwnerNotificationNumber(data.ownerNotificationNumber));
  }, [data?.ownerNotificationNumber, data?.ownerNotificationName]);

  const phoneMutation = useMutation({
    mutationFn: () =>
      persistPhone({
        data: {
          owner_notification_name: name.trim() || null,
          owner_notification_number: phone.trim() || null,
        },
      }),
    onSuccess: (result) => {
      setPhoneError(null);
      setSavedAt(new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }));
      toast.success(
        result.ownerNotificationNumber
          ? "Owner notification number saved"
          : "Owner notification number cleared. Owner alerts are off.",
      );
      void queryClient.invalidateQueries({ queryKey: ["tenant-account"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (mutationError: Error) => {
      setPhoneError(mutationError.message);
      toast.error(mutationError.message);
    },
  });

  const logoMutation = useMutation({
    mutationFn: (payload: { content_type: string; data_base64: string }) =>
      persistLogo({ data: payload }),
    onSuccess: () => {
      setPreview(null);
      setLogoError(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success("Logo saved");
      void queryClient.invalidateQueries({ queryKey: ["tenant-account"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => {
      setLogoError(mutationError.message);
      toast.error(mutationError.message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => dropLogo(),
    onSuccess: () => {
      setPreview(null);
      setLogoError(null);
      toast.success("Logo removed. Default branding is back.");
      void queryClient.invalidateQueries({ queryKey: ["tenant-account"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading account details…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const readOnly = data.role !== "owner";
  const phoneTouched = phone.trim().length > 0;
  const phoneLooksValid = !phoneTouched || isValidOwnerNotificationNumber(phone);

  async function onPickFile(file: File) {
    setLogoError(null);
    const check = validateLogoUpload({ contentType: file.type, size: file.size });
    if (!check.ok) {
      setLogoError(check.reason);
      setPreview(null);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("That file could not be read."));
      reader.readAsDataURL(file);
    }).catch((readError: Error) => {
      setLogoError(readError.message);
      return "";
    });
    if (!dataUrl) return;

    const image = new Image();
    image.onload = () => {
      if (Math.max(image.width, image.height) > MAX_LOGO_PIXELS) {
        setLogoError(`That image is too large. Keep it under ${MAX_LOGO_PIXELS}px on the longest edge.`);
        setPreview(null);
        return;
      }
      setPreview({ url: dataUrl, base64: dataUrl, type: check.contentType });
    };
    image.onerror = () => setLogoError("That file is not a readable image.");
    image.src = dataUrl;
  }

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Account details</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Where booking alerts are texted, and the logo customers see. These are separate from your
        sending line and your public callback number.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Assigned SMS sending line (from)</dt>
          <dd className="mt-1 text-sm font-medium">{data.sendingLine ?? "Not configured"}</dd>
          <dd className="text-xs text-muted-foreground">Managed by BookedSecure.</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Public callback number</dt>
          <dd className="mt-1 text-sm font-medium">{data.callbackNumber ?? "Not set"}</dd>
          <dd className="text-xs text-muted-foreground">Shown to customers where configured.</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-md border border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Owner notification number
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Booking confirmations are texted here. Currently saved: {data.ownerNotificationMasked}.
          Customers never see this number.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Owner name</span>
            <input
              disabled={readOnly}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Usama Ahmed"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Mobile number</span>
            <input
              disabled={readOnly}
              value={phone}
              inputMode="tel"
              onChange={(event) => {
                setPhone(event.target.value);
                setPhoneError(null);
                setSavedAt(null);
              }}
              placeholder="0447 852 565"
              aria-invalid={!phoneLooksValid}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm disabled:opacity-60"
            />
          </label>
        </div>
        {phoneTouched && !phoneLooksValid && (
          <p className="mt-2 text-xs text-destructive">
            {validateOwnerNotificationNumber(phone).ok ? "" : "Enter an Australian mobile, for example 0447 852 565."}
          </p>
        )}
        {phoneError && <p className="mt-2 text-xs text-destructive">{phoneError}</p>}
        {savedAt && !phoneError && (
          <p className="mt-2 text-xs text-muted-foreground">Saved at {savedAt}.</p>
        )}
        {!readOnly && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
              onClick={() => phoneMutation.mutate()}
              disabled={phoneMutation.isPending || !phoneLooksValid}
            >
              {phoneMutation.isPending ? "Saving…" : "Save number"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
              onClick={() => {
                setPhone("");
                setPhoneError(null);
              }}
              disabled={phoneMutation.isPending || !phoneTouched}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-md border border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Business logo
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Shown on your quote page, in the quote chat and in your dashboard header. PNG, JPEG or
          WebP, under {Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB. Logos are never included in
          text messages.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <TenantMark name={data.businessName} logoUrl={data.logoUrl} size={56} />
            <span className="text-xs text-muted-foreground">
              {data.hasCustomLogo ? "Current logo" : "Default branding"}
            </span>
          </div>
          {preview && (
            <div className="flex items-center gap-2">
              <img
                src={preview.url}
                alt="Selected logo preview"
                className="h-14 w-14 rounded-md bg-secondary object-contain"
              />
              <span className="text-xs text-muted-foreground">Preview, not saved yet</span>
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={Object.keys(ALLOWED_LOGO_TYPES).join(",")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickFile(file);
              }}
              className="text-xs"
            />
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
              onClick={() =>
                preview &&
                logoMutation.mutate({ content_type: preview.type, data_base64: preview.base64 })
              }
              disabled={!preview || logoMutation.isPending}
            >
              {logoMutation.isPending
                ? "Uploading…"
                : data.hasCustomLogo
                  ? "Replace logo"
                  : "Save logo"}
            </button>
            {data.hasCustomLogo && (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? "Removing…" : "Remove logo"}
              </button>
            )}
          </div>
        )}
        {logoError && <p className="mt-2 text-xs text-destructive">{logoError}</p>}
      </div>
    </section>
  );
}
