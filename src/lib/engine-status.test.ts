import { describe, expect, it } from "vitest";
import { readEngineMachines, stopWouldInterrupt, type FlyMachine } from "@/lib/engine-status";

const machine = (over: Partial<FlyMachine>): FlyMachine => ({ id: "m1", state: "stopped", ...over });
const cleanExit = { type: "exit", request: { exit_event: { exit_code: 0 } } };

describe("reading the engine's state", () => {
  it("is on when running and healthy", () => {
    expect(readEngineMachines([machine({ state: "started", checks: [{ status: "passing" }] })]).state).toBe("on");
  });
  it("is orange while a running machine isn't healthy yet", () => {
    expect(readEngineMachines([machine({ state: "started", checks: [{ status: "warning" }] })])).toMatchObject({ state: "idle", label: "Starting" });
  });
  it("is orange while changing state", () => {
    expect(readEngineMachines([machine({ state: "replacing" })]).state).toBe("idle");
  });
  it("is idle after putting itself to sleep", () => {
    expect(readEngineMachines([machine({ events: [cleanExit] })])).toMatchObject({ state: "idle", label: "Idle" });
  });
  it("is idle after being asked to stop", () => {
    expect(readEngineMachines([machine({ events: [{ type: "exit", request: { exit_event: { exit_code: 137, requested_stop: true } } }] })]).state).toBe("idle");
  });
  it("is off after a crash", () => {
    expect(readEngineMachines([machine({ events: [{ type: "crash" }, { type: "start" }, cleanExit] })]).state).toBe("off");
  });
  it("is off after an unrequested failing exit", () => {
    expect(readEngineMachines([machine({ events: [{ type: "exit", request: { exit_event: { exit_code: 1 } } }] })]).state).toBe("off");
  });
  it("ignores older crashes once it has exited cleanly since", () => {
    expect(readEngineMachines([machine({ events: [{ type: "update" }, cleanExit, { type: "crash" }] })]).state).toBe("idle");
  });
  it("is off with no machine at all", () => {
    expect(readEngineMachines([]).state).toBe("off");
  });
});

describe("stopping", () => {
  it("counts work that would be interrupted", () => {
    expect(stopWouldInterrupt({ pending: 2, running: 1 })).toBe(3);
    expect(stopWouldInterrupt(null)).toBe(0);
  });
});
