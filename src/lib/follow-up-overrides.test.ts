import { describe, expect, it } from "vitest";
import {
  MAX_FOLLOW_UP_DELAY_MINUTES,
  mergeFollowUpOverride,
  parseFollowUpOverrides,
  resolveFollowUpStep,
} from "./follow-up-overrides";

describe("follow-up overrides", () => {
  it("ignores malformed stored data", () => {
    expect(parseFollowUpOverrides(null)).toEqual({});
    expect(parseFollowUpOverrides([1])).toEqual({});
    expect(parseFollowUpOverrides({ abc: { delay_minutes: 5 }, "1": "nope", "2": { delay_minutes: -4 } })).toEqual({});
  });

  it("clamps delays to a week and trims templates", () => {
    const parsed = parseFollowUpOverrides({
      "1": { delay_minutes: 99999999, message_template: "  Hi {{first_name}}  " },
    });
    expect(parsed["1"]).toEqual({
      delay_minutes: MAX_FOLLOW_UP_DELAY_MINUTES,
      message_template: "Hi {{first_name}}",
    });
  });

  it("lays a lead's own step over the shared rule and flags it", () => {
    const rule = { step: 2, delay_minutes: 300, message_template: "shared" };
    expect(resolveFollowUpStep(rule, {})).toEqual({ ...rule, overridden: false });
    expect(resolveFollowUpStep(rule, { "2": { message_template: "mine" } })).toEqual({
      step: 2,
      delay_minutes: 300,
      message_template: "mine",
      overridden: true,
    });
  });

  it("merges and clears individual fields", () => {
    let current = mergeFollowUpOverride({}, 1, { delay_minutes: 30, message_template: "a" });
    expect(current).toEqual({ "1": { delay_minutes: 30, message_template: "a" } });
    current = mergeFollowUpOverride(current, 1, { message_template: null });
    expect(current).toEqual({ "1": { delay_minutes: 30 } });
    current = mergeFollowUpOverride(current, 1, { delay_minutes: null });
    expect(current).toEqual({});
  });
});
