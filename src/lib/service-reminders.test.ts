import { describe, expect, it } from "vitest";
import {
  daysToMinutes,
  defaultServiceIntervalDays,
  defaultServiceReminderTemplate,
  intervalLabel,
  minutesToDays,
  renderServiceReminder,
  serviceReminderDecision,
  serviceReminderTemplateProblem,
} from "./service-reminders";

const DAY = 86_400_000;

describe("service reminders", () => {
  it("starts from the website reader's return visit, else the trade's cycle, else 3 months", () => {
    expect(defaultServiceIntervalDays("auto_marine_detailing", null)).toBe(42);
    expect(defaultServiceIntervalDays(null, 180)).toBe(180);
    expect(defaultServiceIntervalDays("other", null)).toBe(90);
  });

  it("labels intervals and stores them in minutes", () => {
    expect(intervalLabel(42)).toBe("6 weeks");
    expect(intervalLabel(90)).toBe("3 months");
    expect(intervalLabel(180)).toBe("6 months");
    expect(intervalLabel(365)).toBe("12 months");
    expect(minutesToDays(daysToMinutes(180))).toBe(180);
  });

  it("renders the message with the booking link", () => {
    const text = renderServiceReminder(defaultServiceReminderTemplate(), { customerName: "Sam Smith", businessName: "Auburn Auto", intervalDays: 180, bookingLink: "https://bookedsecure.com/b/abc" });
    expect(text).toBe("Hi Sam, it's been about 6 months since your last visit with Auburn Auto. Due for your next one? Book here: https://bookedsecure.com/b/abc");
    expect(serviceReminderTemplateProblem("Hi there, come back soon please")).toMatch(/booking_link/);
    expect(serviceReminderTemplateProblem(defaultServiceReminderTemplate())).toBeNull();
  });

  it("is due after the interval, within two weeks", () => {
    const now = new Date("2026-11-11T00:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    expect(serviceReminderDecision(ago(100), 180, now)).toBe("not_yet");
    expect(serviceReminderDecision(ago(181), 180, now)).toBe("due");
    expect(serviceReminderDecision(ago(200), 180, now)).toBe("too_old");
    expect(serviceReminderDecision(null, 180, now)).toBe("none");
  });
});
