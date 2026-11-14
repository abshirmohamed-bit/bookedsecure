import { describe, expect, it } from "vitest";
import { countSegments } from "@/lib/sms/segments";
import {
  fitSms, fitTelegram, gatewayEmailAddress, gatewayRequest, gatewayTokenFrom, gatewayTools, hashCode, isAutomaticEmail,
  isPauseWord, plainText, randomCode, randomToken, safeEqual, telegramCommand, TELEGRAM_REPLY_MAX,
} from "@/lib/cowork-gateway";

const LINK = "https://bookedsecure.com/assistant/abc";

describe("gatewayTools", () => {
  it("keeps reading, preparing and remembering only", () => {
    const all = { today_overview: 1, remember: 2, send_text: 3, book_job: 4, publish_linkedin_post: 5, create_routine: 6, delete_clipped_video: 7 };
    expect(Object.keys(gatewayTools(all)).sort()).toEqual(["remember", "send_text", "today_overview"]);
  });
});

describe("fitSms", () => {
  it("keeps a short answer as it is", () => {
    expect(fitSms("**3 bookings** today.", LINK)).toBe("3 bookings today.");
  });
  it("adds the link when something waits for a yes", () => {
    expect(fitSms("Drafted the text to Sam.", LINK, { needsLink: true })).toBe(`Drafted the text to Sam. ${LINK}`);
  });
  it("cuts a long answer to three parts with the link", () => {
    const out = fitSms("word ".repeat(400), LINK);
    expect(countSegments(out).segments).toBeLessThanOrEqual(3);
    expect(out.endsWith(LINK)).toBe(true);
    expect(out).toContain("More:");
  });
});

describe("fitTelegram", () => {
  it("adds the approval link and stays under Telegram's limit", () => {
    expect(fitTelegram("Ready.", LINK, true)).toBe(`Ready.\n\nReady for your yes in Co-Work: ${LINK}`);
    expect(fitTelegram("x".repeat(9000), LINK, false).length).toBeLessThanOrEqual(TELEGRAM_REPLY_MAX);
  });
});

describe("plainText", () => {
  it("drops markdown and flattens tables", () => {
    const md = "## Today\n**Bookings:** 3\n| Name | Time |\n|---|---|\n| Sam | 9am |\n- one\n* two";
    expect(plainText(md)).toBe("Today\nBookings: 3\nName, Time\nSam, 9am\n- one\n- two");
  });
});

describe("commands and words", () => {
  it("knows pause words but not sentences", () => {
    expect(isPauseWord("STOP")).toBe(true);
    expect(isPauseWord(" pause. ")).toBe(true);
    expect(isPauseWord("stop the campaign to Sam")).toBe(false);
  });
  it("reads Telegram commands", () => {
    expect(telegramCommand("/start abc123")).toEqual({ command: "start", arg: "abc123" });
    expect(telegramCommand("/new@BookedSecureBot")).toEqual({ command: "new", arg: "" });
    expect(telegramCommand("what's on today?")).toBeNull();
  });
});

describe("email gateway", () => {
  it("finds the token among recipients", () => {
    const token = randomToken(24);
    expect(gatewayTokenFrom(["Someone <x@y.com>", `Co-Work <${gatewayEmailAddress(token)}>`])).toBe(token);
    expect(gatewayTokenFrom(["cowork@bookedsecure.com", "reply+abc@reply.bookedsecure.com"])).toBeNull();
  });
  it("never answers automatic mail", () => {
    expect(isAutomaticEmail("me@x.com", { "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutomaticEmail("me@x.com", { Precedence: "bulk" })).toBe(true);
    expect(isAutomaticEmail("MAILER-DAEMON@x.com", {})).toBe(true);
    expect(isAutomaticEmail("me@x.com", { "Auto-Submitted": "no" })).toBe(false);
  });
});

describe("codes and secrets", () => {
  it("makes six-digit codes and binds hashes to the gateway", async () => {
    expect(randomCode()).toMatch(/^\d{6}$/);
    expect(await hashCode("a", "123456")).toBe(await hashCode("a", " 123456 "));
    expect(await hashCode("a", "123456")).not.toBe(await hashCode("b", "123456"));
  });
  it("compares secrets", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("tells Co-Work how to answer and what waits for a yes", () => {
    const q = gatewayRequest("sms", "what's on today?");
    expect(q).toContain("text message");
    expect(q).toContain("tap Confirm in Co-Work");
    expect(q.endsWith("what's on today?")).toBe(true);
  });
});
