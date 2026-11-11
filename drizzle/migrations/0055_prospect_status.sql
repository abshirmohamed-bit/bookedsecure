-- Prospect status for leads: businesses found with Lead finder that haven't
-- enquired yet. Lovable: please apply this as one migration exactly as written.
-- It only widens the allowed statuses; no row changes except Lead finder rows,
-- which move from previous_lead to prospect (only while still untouched).
DO $$
DECLARE c record;
BEGIN
  -- Drop whichever check currently limits leads.status (its name may vary).
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.leads'::regclass AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%previous_lead%'
  LOOP
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK (status IN (
  'new', 'previous_lead', 'prospect', 'contacted', 'waiting_for_customer', 'customer_replied',
  'ready_for_quote', 'quote_sent', 'scheduled', 'completed', 'lost', 'opted_out', 'invalid'
));

UPDATE public.leads SET status = 'prospect'
WHERE status = 'previous_lead' AND source_metadata ? 'lead_finder' AND deleted_at IS NULL;
