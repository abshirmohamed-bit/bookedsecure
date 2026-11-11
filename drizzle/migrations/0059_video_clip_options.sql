-- How a video should be clipped, chosen before the Engine runs: the layout
-- (auto, full-video, split, grid, screen, pip, streamer, black-box,
-- title-subtitles), zoom (off, auto, moments), caption style, caption position
-- and size, and whether clips get a headline. Co-Work and Studio set it; the
-- server passes it to the Engine when the job is submitted. Null means the
-- Engine's defaults.
ALTER TABLE public.video_clip_jobs ADD COLUMN IF NOT EXISTS options jsonb;
