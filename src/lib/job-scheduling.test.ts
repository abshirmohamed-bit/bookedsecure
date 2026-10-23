import { describe, expect, it, vi } from "vitest";
import { saveScheduledJob } from "@/lib/job-scheduling.server";

const input = { businessId: "tenant-a", leadId: "new-lead", scheduledAt: "2026-10-20T23:00:00.000Z" };
function client(result: { data: string | null; error: { code?: string; message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("owner scheduling result", () => {
  it("reports a unique time-slot conflict instead of success", async () => {
    const db = client({ data: null, error: { code: "23505", message: "duplicate slot" } });
    await expect(saveScheduledJob(db as never, input)).rejects.toThrow("That time is already booked");
  });
  it("reports other rejected writes instead of success", async () => {
    const db = client({ data: null, error: { message: "This lead has been deleted" } });
    await expect(saveScheduledJob(db as never, input)).rejects.toThrow("This lead has been deleted");
  });
  it("does not report success without a saved job", async () => {
    await expect(saveScheduledJob(client({ data: null, error: null }) as never, input)).rejects.toThrow("Could not save");
  });
  it("returns success only for a saved job and scopes the request to its tenant", async () => {
    const db = client({ data: "saved-job", error: null });
    await expect(saveScheduledJob(db as never, input)).resolves.toEqual({ ok: true, jobId: "saved-job" });
    expect(db.rpc).toHaveBeenCalledWith("schedule_owner_job", {
      p_business_id: "tenant-a", p_lead_id: "new-lead", p_scheduled_at: "2026-10-20T23:00:00.000Z",
    });
  });
});