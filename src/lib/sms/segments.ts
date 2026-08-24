// SMS segment counting. Billing and usage caps count segments, not messages.

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

export type SegmentInfo = {
  segments: number;
  encoding: "gsm7" | "ucs2";
  characters: number;
};

/** Counts the billable segments of an SMS body (GSM-7 160/153, UCS-2 70/67). */
export function countSegments(body: string): SegmentInfo {
  const chars = Array.from(body);
  const isGsm7 = chars.every(
    (char) => GSM7_BASIC.includes(char) || GSM7_EXTENDED.includes(char),
  );

  if (isGsm7) {
    // Extended characters take two septets each.
    const units = chars.reduce(
      (total, char) => total + (GSM7_EXTENDED.includes(char) ? 2 : 1),
      0,
    );
    const segments = units <= 160 ? 1 : Math.ceil(units / 153);
    return { segments: Math.max(1, segments), encoding: "gsm7", characters: units };
  }

  // UCS-2: surrogate pairs occupy two code units.
  const units = body.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { segments: Math.max(1, segments), encoding: "ucs2", characters: units };
}
