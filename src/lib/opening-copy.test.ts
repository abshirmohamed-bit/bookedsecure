// Guards the customer-facing opening copy on the public quote page.
//
// The opening message is presentation-only JSX, so this test asserts on the
// component source: exactly one welcome line, no reintroduced preamble, and no
// dash punctuation in that line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSuppressedOpeningTurn } from "@/lib/web-chat-presentation";

const source = readFileSync("src/components/AiQuoteChat.tsx", "utf8");

describe("quote page opening copy", () => {
  it("renders the welcome line exactly once", () => {
    const matches = source.match(
      /Hi, welcome to \$\{tenant\.name\}\. Choose a service or tell us what you need\./g,
    );
    expect(matches).toHaveLength(1);
  });

  it("does not reintroduce the old preamble, disclaimer or example request", () => {
    for (const phrase of [
      "online quote assistant",
      "can't quote a price here",
      "pick a service below",
      "we offer a range of services",
    ]) {
      expect(source).not.toContain(phrase);
    }
  });

  it("keeps the stored opening turns hidden from the transcript", () => {
    expect(
      isSuppressedOpeningTurn("Hi — you're chatting with Glocast's online quote assistant."),
    ).toBe(true);
    expect(
      isSuppressedOpeningTurn(
        "Tell me what you need in your own words — for example “ceramic coating”. You can also pick a service below.",
      ),
    ).toBe(true);
    expect(isSuppressedOpeningTurn("Which suburb is the vehicle in?")).toBe(false);
  });
});
