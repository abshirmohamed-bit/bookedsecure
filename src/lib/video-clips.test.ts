import { describe, expect, it } from "vitest";
import { clipsToRender, isActiveJob, isPublicVideoLink, isTemporaryEngineError, jobStatusLabel, transcriptText } from "@/lib/video-clips";

describe("links the Engine may fetch", () => {
  it.each(["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://cdn.example.com/talk.mp4"])("allows %s", (url) => {
    expect(isPublicVideoLink(url)).toBe(true);
  });
  it.each([
    "http://example.com/a.mp4", "https://localhost/a.mp4", "https://127.0.0.1/a.mp4", "https://169.254.169.254/latest",
    "https://[::1]/a.mp4", "https://api.internal/a", "https://printer.local/a", "https://user:pw@example.com/a", "file:///etc/passwd", "--exec=x", "https://intranet/a",
  ])("refuses %s", (url) => {
    expect(isPublicVideoLink(url)).toBe(false);
  });
});

describe("which clips render by themselves", () => {
  it("takes the best three, highest score first", () => {
    const clips = [{ id: "a", score: 10 }, { id: "b", score: 90 }, { id: "c", score: null }, { id: "d", score: 50 }, { id: "e", score: 70 }];
    expect(clipsToRender(clips).map((c) => c.id)).toEqual(["b", "e", "d"]);
  });
  it("does not change the list it was given", () => {
    const clips = [{ id: "a", score: 1 }, { id: "b", score: 2 }];
    clipsToRender(clips);
    expect(clips[0]?.id).toBe("a");
  });
});

describe("when the Engine says no", () => {
  it.each(["JOB_LIMIT_REACHED", "RATE_LIMITED", "ENGINE_UNREACHABLE", "HTTP_503"])("keeps the job waiting on %s", (code) => {
    expect(isTemporaryEngineError(code)).toBe(true);
  });
  it.each(["VALIDATION_ERROR", "NOT_FOUND", "HTTP_400"])("fails the job on %s", (code) => {
    expect(isTemporaryEngineError(code)).toBe(false);
  });
});

describe("a pasted video's transcript", () => {
  const lines = [
    { start_ms: 0, end_ms: 2000, text: "Hello" },
    { start_ms: 12_000, end_ms: 14_000, text: "there" },
    { start_ms: 31_000, end_ms: 33_000, text: "next part" },
    { start_ms: 65_500, end_ms: 67_000, text: "later" },
  ];
  it("groups words into stamped half-minute blocks", () => {
    expect(transcriptText(lines)).toEqual({ text: "[0:00] Hello there\n[0:31] next part\n[1:05] later", cut: false });
  });
  it("says when it had to cut", () => {
    expect(transcriptText(lines, 10)).toEqual({ text: "[0:00] Hel", cut: true });
  });
  it("copes with no captions", () => {
    expect(transcriptText([])).toEqual({ text: "", cut: false });
  });
});

describe("what the owner is told", () => {
  it("names the real stage", () => {
    expect(jobStatusLabel({ status: "PROCESSING", stage: "FINDING" })).toBe("Finding the best moments");
    expect(jobStatusLabel({ status: "PROCESSING", stage: null })).toBe("Working on it");
  });
  it("knows what is still moving", () => {
    expect(isActiveJob("PROCESSING")).toBe(true);
    expect(isActiveJob("WAITING")).toBe(false);
    expect(isActiveJob("COMPLETED")).toBe(false);
  });
});
