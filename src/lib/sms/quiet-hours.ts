// Pure quiet-hours decision for the final outbound SMS gate. No I/O, so the
// engine and the tests share exactly the same decision.

import { businessLocalHour, isQuietHour } from "@/lib/domain";

export const QUIET_HOURS_BLOCKED_CODE = "quiet_hours_blocked" as const;

export type QuietHoursSettings = {
  /** Tenant timezone (IANA). Never hardcode a zone. */
  timezone: string;
  quiet_hours_start: number;
  quiet_hours_end: number;
};

export type QuietHoursGate =
  | { blocked: false; localHour: number }
  | {
      blocked: true;
      code: typeof QUIET_HOURS_BLOCKED_CODE;
      localHour: number;
      start: number;
      end: number;
      reason: string;
    };

/**
 * Evaluates the tenant's configured quiet-hours window at `at`, in the tenant's
 * own timezone. The window itself is never modified here.
 */
export function evaluateQuietHoursGate(settings: QuietHoursSettings, at: Date): QuietHoursGate {
  const localHour = businessLocalHour(settings.timezone, at);
  if (!isQuietHour(localHour, settings.quiet_hours_start, settings.quiet_hours_end)) {
    return { blocked: false, localHour };
  }
  return {
    blocked: true,
    code: QUIET_HOURS_BLOCKED_CODE,
    localHour,
    start: settings.quiet_hours_start,
    end: settings.quiet_hours_end,
    reason: `Quiet hours (${settings.quiet_hours_start}:00–${settings.quiet_hours_end}:00 ${settings.timezone}). nothing was sent.`,
  };
}

/**
 * Operational, customer-triggered transactional messages that must never be
 * held back by the tenant's quiet window. The allow-list is deliberately
 * template-scoped: only the versioned booking-confirmation template qualifies,
 * and only on the operational (non-automated) send path. Nothing promotional,
 * no sequence step and no AI-authored copy can ever be exempt.
 */
export const QUIET_HOURS_EXEMPT_TEMPLATE_IDS = ["booking_confirmation.v2"] as const;

export function isQuietHoursExemptTransactional(input: {
  templateId: string | null | undefined;
  kind: string;
}): boolean {
  if (input.kind !== "manual") return false;
  const id = (input.templateId ?? "").trim();
  return (QUIET_HOURS_EXEMPT_TEMPLATE_IDS as readonly string[]).includes(id);
}
