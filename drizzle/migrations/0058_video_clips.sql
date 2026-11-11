-- Video clipping (Social media and Co-work). The Engine in engine/ cuts long
-- videos into short clips; these tables record which business each piece of
-- work belongs to, because the Engine itself has no idea of businesses.
-- Written only by the server; each business can read its own rows.

CREATE TABLE IF NOT EXISTS public.video_clip_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  created_by uuid,
  source_kind text NOT NULL CHECK (source_kind IN ('upload', 'link')),
  source_name text NOT NULL,
  source_url text,
  rights_confirmed boolean NOT NULL DEFAULT false,
  engine_upload_id text,
  engine_asset_id text,
  engine_job_id text UNIQUE,
  thumbnail_url text,
  duration_ms bigint,
  status text NOT NULL DEFAULT 'UPLOADING'
    CHECK (status IN ('UPLOADING', 'INGESTING', 'IMPORTING', 'WAITING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  clip_requested boolean NOT NULL DEFAULT false,
  stage text,
  progress integer NOT NULL DEFAULT 0,
  aspect text NOT NULL DEFAULT '9:16' CHECK (aspect IN ('9:16', '1:1', '4:5', '16:9')),
  clip_count integer CHECK (clip_count IS NULL OR clip_count BETWEEN 1 AND 20),
  instructions text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_clip_jobs_business_idx ON public.video_clip_jobs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_clip_jobs_active_idx ON public.video_clip_jobs (status)
  WHERE status IN ('INGESTING', 'IMPORTING', 'QUEUED', 'PROCESSING');

CREATE TABLE IF NOT EXISTS public.video_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.video_clip_jobs (id) ON DELETE CASCADE,
  engine_project_id text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text,
  reason text,
  score numeric,
  start_ms bigint,
  end_ms bigint,
  duration_ms bigint,
  thumbnail_url text,
  status text NOT NULL DEFAULT 'FOUND' CHECK (status IN ('FOUND', 'EXPORTING', 'READY', 'FAILED')),
  engine_export_id text UNIQUE,
  video_url text,
  width integer,
  height integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, engine_project_id)
);
CREATE INDEX IF NOT EXISTS video_clips_business_idx ON public.video_clips (business_id, created_at DESC);

REVOKE ALL ON public.video_clip_jobs, public.video_clips FROM anon, authenticated;
GRANT SELECT ON public.video_clip_jobs, public.video_clips TO authenticated;
GRANT ALL ON public.video_clip_jobs, public.video_clips TO service_role;
ALTER TABLE public.video_clip_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_clip_jobs_read ON public.video_clip_jobs FOR SELECT TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY video_clips_read ON public.video_clips FOR SELECT TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));
