// Outbound provider resolution with a business-level simulation safety gate.
//
// The sender row normally owns the carrier decision, but a business explicitly
// configured as `simulated` must never reach an external carrier. a stale or
// mistaken sender-level value (e.g. "twilio" on a test number) cannot bypass it.

export const SIMULATED_PROVIDER = "simulated";

export function resolveEffectiveProviderName(
  businessDefaultProvider: string | null | undefined,
  senderProvider: string | null | undefined,
): string {
  if (businessDefaultProvider === SIMULATED_PROVIDER) return SIMULATED_PROVIDER;
  return senderProvider || businessDefaultProvider || SIMULATED_PROVIDER;
}
