/**
 * Slice 2 fix: the hourly pilot-expiry endpoint must only accept the managed
 * server-side cron secret. The publishable key must never authorise it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processPilotExpiry = vi.fn();
vi.mock("@/lib/billing.server", () => ({
  processPilotExpiry: (...args: unknown[]) => processPilotExpiry(...args),
}));

const CRON_SECRET = "test-cron-secret-abc123";
const PUBLISHABLE_KEY = "sb_publishable_WHi8jU1SJMy0w1-JeuojfA_ie90kzam";

type Handler = (ctx: { request: Request }) => Promise<Response>;

async function getHandler(): Promise<Handler> {
  const mod = await import("@/routes/api/public/hooks/pilot-expiry");
  const route = mod.Route as unknown as {
    options: { server: { handlers: { POST: Handler } } };
  };
  return route.options.server.handlers.POST;
}

function post(headers: Record<string, string>) {
  return new Request("https://example.test/api/public/hooks/pilot-expiry", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ source: "pg_cron" }),
  });
}

describe("pilot-expiry cron authentication", () => {
  beforeEach(() => {
    processPilotExpiry.mockReset();
    processPilotExpiry.mockResolvedValue({ checked: 0, expired: 0, applicationIds: [] });
    process.env["LOVABLE_CRON_SECRET"] = CRON_SECRET;
    delete process.env["LOVABLE_CRON_SECRET_PREVIOUS"];
  });

  afterEach(() => {
    delete process.env["LOVABLE_CRON_SECRET"];
  });

  it("rejects the public publishable key", async () => {
    const handler = await getHandler();
    const viaApiKey = await handler({ request: post({ apikey: PUBLISHABLE_KEY }) });
    const viaBearer = await handler({
      request: post({ authorization: `Bearer ${PUBLISHABLE_KEY}` }),
    });
    expect(viaApiKey.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(processPilotExpiry).not.toHaveBeenCalled();
  });

  it("rejects an invalid or missing cron secret with 401", async () => {
    const handler = await getHandler();
    expect((await handler({ request: post({}) })).status).toBe(401);
    expect((await handler({ request: post({ authorization: "Bearer wrong" }) })).status).toBe(401);
    expect((await handler({ request: post({ authorization: CRON_SECRET }) })).status).toBe(401);
    expect(processPilotExpiry).not.toHaveBeenCalled();
  });

  it("runs the expiry pass for a valid cron secret", async () => {
    const handler = await getHandler();
    const response = await handler({ request: post({ authorization: `Bearer ${CRON_SECRET}` }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checked: 0, expired: 0, applicationIds: [] });
    expect(processPilotExpiry).toHaveBeenCalledTimes(1);
  });

  it("stays idempotent when the scheduler runs repeatedly", async () => {
    const handler = await getHandler();
    processPilotExpiry
      .mockResolvedValueOnce({ checked: 1, expired: 1, applicationIds: ["app-1"] })
      .mockResolvedValueOnce({ checked: 0, expired: 0, applicationIds: [] });

    const first = await (
      await handler({ request: post({ authorization: `Bearer ${CRON_SECRET}` }) })
    ).json();
    const second = await (
      await handler({ request: post({ authorization: `Bearer ${CRON_SECRET}` }) })
    ).json();

    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
    expect(processPilotExpiry).toHaveBeenCalledTimes(2);
  });
});
