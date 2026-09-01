import { useState } from "react";
import { brandInitial, sanitiseLogoUrl } from "@/lib/tenant-branding";
import { cn } from "@/lib/utils";

/**
 * Tenant logo with an initial-badge fallback. The URL is sanitised here so both
 * the public quote form and the authenticated shell share one safe render path,
 * and a broken image at runtime falls back to the initial.
 */
export function TenantMark({
  name,
  logoUrl,
  size = 40,
  className,
}: {
  name: string | null | undefined;
  logoUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const safeUrl = sanitiseLogoUrl(logoUrl);
  const label = (name ?? "").trim();

  if (safeUrl && !broken) {
    return (
      <img
        src={safeUrl}
        alt={label ? `${label} logo` : "Business logo"}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-md bg-secondary object-contain", className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground",
        className,
      )}
    >
      {brandInitial(label)}
    </div>
  );
}
