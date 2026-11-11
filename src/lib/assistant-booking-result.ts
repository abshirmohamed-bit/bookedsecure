import { normaliseAuMobile } from '@/lib/domain';
import { formatInZone } from '@/lib/assistant-time';

// Shared by Co-Work tools: turns what the database actually saved into plain words,
// so a saved booking is never read as "no change".
export type BookingResult = {
  ok: true; saved?: boolean; outcome?: string; jobId?: string; scheduledAt?: string | null;
  serviceName?: string | null; status?: string | null; changed?: number;
};

export function bookingOutcomeSummary(result: BookingResult, timeZone: string): string {
  if (!result.saved) return 'The booking action finished, but no saved booking was returned. Check Bookings before telling the owner it saved.';
  const when = result.scheduledAt ? formatInZone(result.scheduledAt, timeZone) : 'no time';
  const service = result.serviceName ? result.serviceName : 'service to confirm';
  const verb: Record<string, string> = {
    created_booking: 'Saved a new booking',
    updated_existing_booking: "Updated this customer's existing booking",
    moved_booking: 'Moved the booking',
    cancel_job: 'Cancelled the booking',
    complete_job: 'Marked the job completed',
    deleted_booking: 'Deleted the booking',
  };
  if (result.outcome === 'deleted_booking') return 'Deleted the booking.';
  return `${verb[result.outcome ?? ''] ?? 'Saved the booking'}: ${when}, ${service}, status ${result.status ?? 'scheduled'}.`;
}

/** Search patterns for a customer query; phone numbers match however they are typed. */
export function customerSearchPatterns(query: string): { text: string; mobile: string | null } {
  const text = query.trim().replace(/[,()]/g, ' ').trim();
  const digits = query.replace(/\D/g, '');
  let mobile: string | null = null;
  if (digits.length >= 6 && /^[\d\s+()-]+$/.test(query.trim())) {
    const full = normaliseAuMobile(query);
    if (full) mobile = full.slice(1); // "61403392447"
    else if (digits.startsWith('0')) mobile = digits.slice(1);
    else if (digits.startsWith('61')) mobile = digits.slice(2);
    else mobile = digits;
  }
  return { text, mobile };
}
