import { describe, expect, it } from "vitest";
import { cropAt, shotAt, transitionAt, transitionLook, type MotionShot } from "./clip-motion";

const still: MotionShot = { start_ms: 0, end_ms: 3000, kind: "fill", window: { x: 100, y: 0, w: 600, h: 1080 }, pan: [[0, 100]] };
const moving: MotionShot = {
  start_ms: 3000, end_ms: 6000, kind: "fill", window: { x: 100, y: 0, w: 600, h: 1080 }, pan: [], transition: "zoomin",
  motion: [[2900, 100, 0, 600, 1080], [3000, 120, 10, 580, 1044], [3100, 140, 20, 560, 1008]],
};

describe("clip motion", () => {
  it("follows the Engine's camera path between its samples", () => {
    expect(cropAt(moving, 3050)).toEqual({ x: 130, y: 15, w: 570, h: 1026 });
    expect(cropAt(moving, 9000)).toEqual({ x: 140, y: 20, w: 560, h: 1008 });
  });
  it("falls back to the window and pan without motion", () => {
    expect(cropAt(still, 1000)).toEqual({ x: 100, y: 0, w: 600, h: 1080 });
  });
  it("finds the transition around a composition change only", () => {
    const shots = [still, moving];
    expect(transitionAt(shots, 2800)).toBeNull();
    const t = transitionAt(shots, 3000);
    expect(t?.name).toBe("zoomin");
    expect(t?.p).toBeCloseTo(0.5);
    expect(transitionAt(shots, 3100)).toBeNull();
    expect(shotAt(shots, 3000)).toBe(moving);
  });
  it("fades the incoming picture in", () => {
    expect(transitionLook("fade", 0).alpha).toBe(0);
    expect(transitionLook("fade", 1).alpha).toBe(1);
    expect(transitionLook("smoothup", 0).slide).toBe(1);
  });
});
