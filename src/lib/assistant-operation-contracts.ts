import { z } from 'zod';
import { LEAD_STATUSES, SOURCE_CHANNELS } from './domain';
import { QUOTE_MODES } from './quote-mode';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const operationInputs = {
  update_customer: z.object({ leadId: uuid, name: z.string().min(1).max(200).nullable(), mobile: z.string().max(20).nullable(), email: z.string().email().nullable(), suburb: z.string().max(200).nullable(), address: z.string().max(500).nullable(), vehicle: z.string().max(200).nullable(), requestedService: z.string().max(500).nullable(), notes: z.string().max(5000).nullable(), status: z.enum(LEAD_STATUSES).nullable(), clearOptOut: z.boolean().nullable() }).strict(),
  book_job: z.object({ leadId: uuid, date, time, serviceName: z.string().max(500).nullable(), notes: z.string().max(5000).nullable() }).strict(),
  reschedule_job: z.object({ jobId: uuid, date, time }).strict(),
  cancel_job: z.object({ jobId: uuid, reason: z.string().max(5000).nullable() }).strict(),
  delete_job: z.object({ jobId: uuid, reason: z.string().max(5000).nullable() }).strict(),
  complete_job: z.object({ leadId: uuid, jobId: uuid.nullable(), paidAmount: z.number().positive().max(1000000).nullable(), serviceName: z.string().max(500).nullable() }).strict(),
  set_addon_availability: z.object({ addonId: uuid, serviceIds: z.array(uuid).min(1).max(200), remove: z.boolean() }).strict(),
  bulk_update_lead_status: z.object({ toStatus: z.enum(LEAD_STATUSES), fromStatuses: z.array(z.enum(LEAD_STATUSES)).nullable(), source: z.enum([...SOURCE_CHANNELS, 'any']).nullable(), origin: z.enum(['live','historical','reactivation','crm_import','any']).nullable(), excludeOptedOut: z.boolean().nullable() }).strict(),
  set_quote_page_mode: z.object({ mode: z.enum(QUOTE_MODES) }).strict(),
  set_sending_paused: z.object({ paused: z.boolean() }).strict(),
  update_follow_up_rule: z.object({ ruleId: uuid, delayMinutes: z.number().int().min(0).max(20160).nullable(), messageTemplate: z.string().min(10).max(600).nullable(), active: z.boolean().nullable() }).strict(),
  set_customer_follow_ups: z.object({ leadId: uuid, paused: z.boolean() }).strict(),
  customise_customer_follow_up: z.object({ leadId: uuid, step: z.number().int().min(1).max(20), messageTemplate: z.string().max(600).nullable(), delayMinutes: z.number().int().min(0).max(10080).nullable(), reset: z.boolean().nullable() }).strict(),
};
export type OperationName = keyof typeof operationInputs;