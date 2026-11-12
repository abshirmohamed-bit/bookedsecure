import { describe, expect, it } from "vitest";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { z } from "zod";
import { videoFrameTiming } from "@/lib/clip-render";
import { socialReviewSearch } from "@/lib/meta-social";
import { signOutWithPushCleanup } from "@/lib/navigation";
import { CLIP_EDITS } from "@/lib/video-clips.functions";

describe("browser clip rendering", () => {
  it("gives every 30 fps frame a non-negative duration accepted by the MP4 muxer", () => {
    const timing = videoFrameTiming(1234.4, 30);
    expect(timing).toEqual({ timestamp: 1234, duration: 33_333 });
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: 1920, height: 1080, frameRate: 30 },
      fastStart: "in-memory",
    });
    expect(() => muxer.addVideoChunkRaw(new Uint8Array([0, 0, 0, 1]), "key", timing.timestamp, timing.duration!)).not.toThrow();
  });
});

describe("dragged caption positions", () => {
  it("keeps a dragged position and the back-to-preset value through edit validation", () => {
    const schema = z.object(CLIP_EDITS);
    expect(schema.parse({ captionY: 0.42 })).toEqual({ captionY: 0.42 });
    expect(schema.parse({ captionY: null })).toEqual({ captionY: null });
    expect(() => schema.parse({ captionY: 1.1 })).toThrow();
  });
});

describe("Home social review", () => {
  it("opens Instagram comments when Instagram has the waiting comment", () => {
    expect(socialReviewSearch("instagram")).toEqual({ view: "comments", platform: "instagram" });
    expect(socialReviewSearch("facebook")).toEqual({ view: "comments", platform: "facebook" });
  });
});

describe("sign out with push alerts", () => {
  it("still signs out when disconnecting the device fails", async () => {
    const calls: string[] = [];
    await signOutWithPushCleanup({
      token: "device-token",
      removeDevice: async () => { calls.push("remove-device"); throw new Error("offline"); },
      clearToken: () => { calls.push("clear-token"); },
      signOut: async () => { calls.push("sign-out"); },
      onSignedOut: () => { calls.push("signed-out"); },
      onPushError: () => { calls.push("push-error"); },
    });
    expect(calls).toEqual(["remove-device", "push-error", "sign-out", "signed-out"]);
  });
});
