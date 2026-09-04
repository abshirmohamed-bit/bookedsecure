// Tenant-scoped sandbox adapters.
//
// The sandbox runs the SAME decision logic as production against injectable
// adapters. Every adapter here is a recorder or a fake: nothing in this file
// imports a provider, a Supabase client, a booking writer, a job enqueuer or a
// notification sender, and there is no I/O of any kind.
//
// Hard isolation invariant (asserted by tests): a sandbox run can only ever
// reach these adapters. `assertSandboxIsolation` throws if any recorder is
// swapped for something that claims a live capability.

import type { GateFailure, GateId } from "../agent-gates";
import type { RenderedAgentMessage } from "../agent-templates";
import type { ActionKind, TemplateId } from "../sequence-actions";
import type { SequenceId } from "../sequences";


export const SANDBOX_EXECUTION_MODE = "sandbox" as const;
export type SandboxExecutionMode = typeof SANDBOX_EXECUTION_MODE;

export class SandboxIsolationError extends Error {
  constructor(message: string) {
    super(`Sandbox isolation violated: ${message}`);
    this.name = "SandboxIsolationError";
  }
}

/** Every sandbox artefact carries the full trace so nothing is ambiguous. */
export type SandboxTrace = {
  tenantId: string;
  testRunId: string;
  scenarioId: string;
  leadFixtureId: string;
  executionMode: SandboxExecutionMode;
  createdAt: string;
};

export type RecordedSms = {
  trace: SandboxTrace;
  recipient: string;
  sequenceId: SequenceId;
  templateId: TemplateId;
  templateVersion: number;
  body: string;
  substitutions: RenderedAgentMessage["substitutions"];
  segments: number;
  encoding: RenderedAgentMessage["segmentInfo"]["encoding"];
  messageSource: string;
  actionKind: ActionKind;
  idempotencyKey: string;
  /** Always false: the recorder never contacts a carrier. */
  sent: false;
  duplicateSuppressed: boolean;
};

export type RecordedNotification = {
  trace: SandboxTrace;
  kind: string;
  detail: string;
  sent: false;
};

export type FakeCalendarSlot = {
  id: string;
  startsAt: string;
  label: string;
  available: boolean;
};

export type SandboxSmsRecorder = {
  readonly kind: "recorder";
  readonly canReachProvider: false;
  record(entry: Omit<RecordedSms, "sent" | "duplicateSuppressed">): RecordedSms;
  entries(): readonly RecordedSms[];
  seenKeys(): readonly string[];
};

export type SandboxNotificationRecorder = {
  readonly kind: "recorder";
  readonly canReachProductionNotifications: false;
  record(entry: Omit<RecordedNotification, "sent">): RecordedNotification;
  entries(): readonly RecordedNotification[];
};

export type SandboxCalendarProvider = {
  readonly kind: "fake_calendar";
  readonly canWriteBookings: false;
  slots(): readonly FakeCalendarSlot[];
  /** Would-create-offer only: returns the slot, writes nothing. */
  select(slotId: string): FakeCalendarSlot | null;
};

export type SandboxAdapters = {
  sms: SandboxSmsRecorder;
  calendar: SandboxCalendarProvider;
  notifications: SandboxNotificationRecorder;
  executionMode: SandboxExecutionMode;
};

/** Recorder SMS provider: captures the exact rendered message, sends nothing. */
export function createSmsRecorder(): SandboxSmsRecorder {
  const entries: RecordedSms[] = [];
  const keys = new Set<string>();
  return {
    kind: "recorder",
    canReachProvider: false,
    record(entry) {
      const duplicateSuppressed = keys.has(entry.idempotencyKey);
      keys.add(entry.idempotencyKey);
      const recorded: RecordedSms = { ...entry, sent: false, duplicateSuppressed };
      entries.push(recorded);
      return recorded;
    },
    entries: () => entries,
    seenKeys: () => [...keys],
  };
}

export function createNotificationsRecorder(): SandboxNotificationRecorder {
  const entries: RecordedNotification[] = [];
  return {
    kind: "recorder",
    canReachProductionNotifications: false,
    record(entry) {
      const recorded: RecordedNotification = { ...entry, sent: false };
      entries.push(recorded);
      return recorded;
    },
    entries: () => entries,
  };
}

/** Deterministic fake calendar. Fixed slots, no availability query, no writes. */
export function createFakeCalendar(
  slots: readonly FakeCalendarSlot[] = DEFAULT_FAKE_SLOTS,
): SandboxCalendarProvider {
  return {
    kind: "fake_calendar",
    canWriteBookings: false,
    slots: () => slots,
    select: (slotId) => slots.find((s) => s.id === slotId && s.available) ?? null,
  };
}

export const DEFAULT_FAKE_SLOTS: readonly FakeCalendarSlot[] = [
  { id: "fake-slot-1", startsAt: "2026-09-07T23:00:00.000Z", label: "Tue 9:00 am", available: true },
  { id: "fake-slot-2", startsAt: "2026-09-08T02:00:00.000Z", label: "Tue 12:00 pm", available: true },
  { id: "fake-slot-3", startsAt: "2026-09-09T23:00:00.000Z", label: "Wed 9:00 am", available: false },
];

export function createSandboxAdapters(
  slots: readonly FakeCalendarSlot[] = DEFAULT_FAKE_SLOTS,
): SandboxAdapters {
  const adapters: SandboxAdapters = {
    sms: createSmsRecorder(),
    calendar: createFakeCalendar(slots),
    notifications: createNotificationsRecorder(),
    executionMode: SANDBOX_EXECUTION_MODE,
  };
  assertSandboxIsolation(adapters);
  return adapters;
}

/**
 * Hard assertion: sandbox mode cannot reach a live provider, a campaign
 * activation, a booking writer or a production notification path. Called at
 * adapter construction AND before every recorded artefact.
 */
export function assertSandboxIsolation(adapters: SandboxAdapters): void {
  if (adapters.executionMode !== SANDBOX_EXECUTION_MODE)
    throw new SandboxIsolationError(`execution mode is ${adapters.executionMode}`);
  if (adapters.sms.kind !== "recorder" || adapters.sms.canReachProvider !== false)
    throw new SandboxIsolationError("sms adapter is not a recorder");
  if (adapters.calendar.kind !== "fake_calendar" || adapters.calendar.canWriteBookings !== false)
    throw new SandboxIsolationError("calendar adapter is not the fake calendar");
  if (
    adapters.notifications.kind !== "recorder" ||
    adapters.notifications.canReachProductionNotifications !== false
  )
    throw new SandboxIsolationError("notification adapter is not a recorder");
}

/** Gate ids that passed, derived from the full gate list minus the failures. */
export function passedGates(
  allGates: readonly GateId[],
  failures: readonly GateFailure[],
): readonly GateId[] {
  const failed = new Set(failures.map((f) => f.gate));
  return allGates.filter((g) => !failed.has(g));
}
