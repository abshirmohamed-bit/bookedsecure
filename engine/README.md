# crayZmundo Engine

Takes a long video and gives back finished vertical clips: transcribed, cut on
sentence boundaries, framed on the speaker, captioned, titled and rendered to a
file the social platforms can fetch.

This is the part that makes crayZmundo standalone. No clipping vendor is called
anywhere. The only outside services are the ones that cannot be avoided: one AI
model for judgement, and the host and bucket you rent.

## What it does

| Step | How |
| --- | --- |
| Ingest | `ffprobe` for the real duration and size, a thumbnail, and a mezzanine at the **source resolution** — a 4K source stays 4K, so a 9:16 crop out of it is still sharp |
| Transcribe | faster-whisper with word-level timestamps, your own vocabulary hinted so names are spelled right |
| Find moments | Claude reads the transcript and picks what works as a short; every pick is snapped to sentence boundaries and de-overlapped |
| Frame | the speaker is tracked and the 9:16 window pans to follow, smoothed so it drifts rather than snaps |
| Caption | word timings become ASS subtitles in one of 20 styles, burned into the render |
| Export | a real 1080×1920 (or 2160×3840) H.264 file on a public URL |

## Running it

```bash
cp .env.example .env
make keygen          # paste the two values into .env
docker compose up -d --build
curl localhost:8080/v1/health
```

Then in crayZmundo: **Settings → Integrations → crayZmundo Engine**, set
`ENGINE_URL` to this host and `ENGINE_API_KEY` to the key you generated. Put the
same `WEBHOOK_SECRET` in both places and press *Send webhook test*.

Locally, without Docker:

```bash
make dev && make run
```

## Configuration

Everything is in `.env.example`. The two that matter most:

- `TRANSCRIBE_PROVIDER` — `faster-whisper` (real; downloads its model on first
  run) or `fake` (deterministic, for tests).
- `FINDER_PROVIDER` — `claude` (real judgement, needs `ANTHROPIC_API_KEY`) or
  `rules` (transcript heuristics; no key, no cost). **Without a key the Engine
  falls back to `rules` rather than failing**, so it always produces clips.

Storage is local disk by default and any S3-compatible bucket in production
(Cloudflare R2, AWS, MinIO). Media URLs are public either way, because
Instagram, TikTok, YouTube and X fetch the file themselves.

## Testing

```bash
make test
```

17 tests. They run a real MP4 through the real pipeline — upload, probe,
transcribe, find, cut, caption, export — and assert on the actual rendered file
(`1080x1920`, H.264, audio present). Speech recognition and the language model
are the only swapped parts, so the suite needs no model weights and no API key
and finishes in about ten seconds.

## Sizing

A 30-minute talk into 10 clips on a 4-core box: transcription dominates
(roughly 0.3–1× real time with the `small` model on CPU), the Claude pass is
cents, and each render is 60–120s. Budget 30–50 minutes of wall clock, or add a
GPU and transcription drops to seconds.

## Notes

- One container runs the API and the worker. There is no Redis: work is queued
  in SQLite and advanced by a background thread. Swap in a real queue only when
  one machine is no longer enough.
- Titles and handles are drawn by ffmpeg rather than a headless browser, which
  keeps the image small. Richer overlays (the ranking and reaction-stack
  formats) are the next piece.
