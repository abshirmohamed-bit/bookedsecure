/** What the video Engine's machines say about whether it is on, idle or off. */
export type EngineState = "on" | "idle" | "off";
export type EngineReading = { state: EngineState; label: string; detail: string };

type MachineEvent = { type?: string; request?: { exit_event?: { exit_code?: number; requested_stop?: boolean } } };
export type FlyMachine = { id: string; state: string; events?: MachineEvent[]; checks?: { status?: string }[] };

const TRANSITIONING = new Set(["created", "starting", "replacing", "updating", "stopping"]);

/** Fly lists events newest first. */
function stoppedCleanly(machine: FlyMachine): boolean {
  const last = (machine.events ?? []).find((e) => e.type === "exit" || e.type === "crash");
  if (!last) return true;
  if (last.type === "crash") return false;
  const exit = last.request?.exit_event;
  return exit?.requested_stop === true || exit?.exit_code === 0 || exit?.exit_code === undefined;
}

/**
 * Read from Fly's records rather than by asking the Engine, because any request
 * to the Engine starts a sleeping machine and would keep it billing.
 */
export function readEngineMachines(machines: readonly FlyMachine[]): EngineReading {
  if (machines.length === 0) return { state: "off", label: "Off", detail: "There's no engine machine." };
  const running = machines.find((m) => m.state === "started");
  if (running) {
    const healthy = (running.checks ?? []).every((c) => c.status === "passing");
    return healthy
      ? { state: "on", label: "On", detail: "Ready to cut video." }
      : { state: "idle", label: "Starting", detail: "The engine is starting up." };
  }
  if (machines.some((m) => TRANSITIONING.has(m.state))) return { state: "idle", label: "Starting", detail: "The engine is changing state." };
  return machines.every(stoppedCleanly)
    ? { state: "idle", label: "Idle", detail: "Asleep to save money. It wakes by itself when a video needs cutting." }
    : { state: "off", label: "Off", detail: "The engine stopped unexpectedly and needs attention." };
}

/** Whether a stop should be held back until the owner has been told what it interrupts. */
export function stopWouldInterrupt(queue: { pending?: number; running?: number } | null | undefined): number {
  return (queue?.pending ?? 0) + (queue?.running ?? 0);
}
