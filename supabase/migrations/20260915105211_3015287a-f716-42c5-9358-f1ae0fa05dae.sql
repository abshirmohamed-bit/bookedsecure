ALTER TABLE public.businesses REPLICA IDENTITY FULL;
ALTER TABLE public.texto_accounts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.businesses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.texto_accounts;