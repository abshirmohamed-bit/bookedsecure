ALTER TABLE public.sms_senders ALTER COLUMN business_id DROP NOT NULL;

-- Platform-owned inventory: approved in the Telnyx portal, not yet activated and
-- deliberately not bound to any business. active = false keeps it unusable.
INSERT INTO public.sms_senders (business_id, phone_number, provider, credential_mode, label, is_primary, active)
SELECT NULL, '+61468045220', 'telnyx', 'platform', 'Telnyx AU pilot number (inventory, inactive)', false, false
WHERE NOT EXISTS (SELECT 1 FROM public.sms_senders WHERE phone_number = '+61468045220');