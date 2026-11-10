import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberOAuthReturn, takeOAuthReturn } from "@/lib/oauth-return-store";

/** Vitest runs in node, so the browser storage the helper needs is faked here. */
function installFakeStorage() {
  const bag = new Map<string, string>();
  const storage = {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => void bag.set(key, value),
    removeItem: (key: string) => void bag.delete(key),
  };
  vi.stubGlobal("window", { sessionStorage: storage });
  return bag;
}

describe("oauth return store", () => {
  let bag: Map<string, string>;

  beforeEach(() => {
    bag = installFakeStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a requested in-app page and hands it over exactly once", () => {
    rememberOAuthReturn("/leads/123?tab=notes");
    expect(takeOAuthReturn()).toBe("/leads/123?tab=notes");
    expect(takeOAuthReturn()).toBeNull();
  });

  it("stores nothing for the home page, so the normal destination wins", () => {
    rememberOAuthReturn("/");
    expect(bag.size).toBe(0);
    expect(takeOAuthReturn()).toBeNull();
  });

  it("refuses an off-site destination", () => {
    rememberOAuthReturn("https://evil.example/steal");
    expect(bag.size).toBe(0);
    expect(takeOAuthReturn()).toBeNull();
  });

  it("refuses a protocol-relative path", () => {
    rememberOAuthReturn("//evil.example/steal");
    expect(bag.size).toBe(0);
    expect(takeOAuthReturn()).toBeNull();
  });

  it("drops a saved destination that points off-site", () => {
    bag.set("bookedsecure:oauth-return", "https://evil.example/steal");
    expect(takeOAuthReturn()).toBeNull();
    expect(bag.has("bookedsecure:oauth-return")).toBe(false);
  });

  it("stays silent when storage is unavailable", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("blocked");
      },
    });
    expect(() => rememberOAuthReturn("/leads")).not.toThrow();
    expect(takeOAuthReturn()).toBeNull();
  });
});
