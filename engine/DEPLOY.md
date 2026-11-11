# Deploying the crayZmundo Engine

**You do not need a terminal for this.** Fly is connected to this GitHub repo and
redeploys the Engine whenever `engine/` changes on `main`. Push, and it ships.

Watch a deploy at https://fly.io/apps/crayzmundo-engine/monitoring

The Engine itself runs continuously — it does not stop when you close your laptop.
Using crayZmundo day to day means opening the site and pasting a link. Nothing else.

---

## If something is wrong

Three commands, and only when you are actually debugging:

```bash
fly logs -a crayzmundo-engine          # why did that fail?
fly status -a crayzmundo-engine        # is it running?
fly deploy ./engine -a crayzmundo-engine   # force a deploy if GitHub did not
```

## If you ever need to set a secret

```bash
fly secrets set NAME="value" -a crayzmundo-engine
```

Setting a secret restarts the machine, which is how it takes effect.

---

## What was set up once, and never needs doing again

| Thing | Value |
| --- | --- |
| App | `crayzmundo-engine` in `syd` |
| Machine | performance-2x, 4GB, always on |
| Volume | `crayz_data`, 10GB at `/data` — database and Whisper weights |
| Object storage | Tigris bucket `long-glitter-1327` for finished clips |
| Secrets | `ENGINE_API_KEYS`, `WEBHOOK_SECRET`, `WEBHOOK_URL`, `PUBLIC_BASE_URL`, `S3_PUBLIC_BASE_URL`, plus the five Fly set for Tigris |

The only one still missing is `AI_API_KEY`, which upgrades moment-finding from
transcript heuristics to real judgement — and is also what makes the "look for
specific moments" box mean anything. Everything works without it; the Engine
reports `finder: rules` until it is set.

Any provider will do. The key's shape says where to send it, so this is
usually the entire setup:

```bash
fly secrets set AI_API_KEY="ci_live_..."    # Cheaper Inference
fly secrets set AI_API_KEY="gsk_..."        # Groq, already in use for audio
fly secrets set AI_API_KEY="sk-ant-..."     # Anthropic
fly secrets set AI_API_KEY="sk-or-..."      # OpenRouter
fly secrets set AI_API_KEY="sk-..."         # OpenAI
```

For anything else — a self-hosted model, a gateway, a provider not listed —
add the address of the API that has `/chat/completions` under it:

```bash
fly secrets set AI_API_KEY="..." AI_BASE_URL="https://llm.example.com/v1" AI_MODEL="your-model"
```

Check it took with `GET /v1/health`: `finder` flips from `rules` to `ai`.

---

## Settings that must not change

**`auto_stop_machines = "off"`** — Fly's proxy cannot see a render in progress, so
autostop would kill jobs mid-encode.

**`kill_timeout = "300s"`** — must stay above the Engine's `SHUTDOWN_GRACE_S` (120s),
or a deploy kills work that is already running. Anything interrupted is requeued on
the next boot, so nothing hangs in "processing" forever.

**These are top-level keys in `fly.toml`.** In TOML a key written after a `[table]`
header belongs to that table, so keep them above the first `[section]`.

---

## Things that will bite you if changed

**`auto_stop_machines = "off"` must stay off.** Fly's proxy only sees inbound
HTTP. It cannot see a render in progress, so with autostop on, Fly would stop
the machine mid-encode and the export would never finish. The Engine puts
itself to sleep instead — see "Paying only for the hours you use" below.

**`[[restart]] policy = "on-failure"` must stay that way.** The Engine shuts
itself down with a clean exit when idle. `policy = "always"` would restart it
within seconds and the machine would never actually sleep.

**`kill_timeout = "300s"` must stay above `SHUTDOWN_GRACE_S` (120s).** On
deploy, Fly sends SIGTERM; the Engine stops taking new work and lets the
current render finish. If the timeout is shorter than the render, Fly sends
SIGKILL and the work is lost. Anything interrupted anyway is put back in the
queue on the next boot, so nothing hangs in "processing" forever.

**These are top-level keys in `fly.toml`.** In TOML, a key written after a
`[table]` header belongs to that table. Keep `kill_signal` and `kill_timeout`
above the first `[section]` or Fly silently ignores them.

---

## Optional: run the tests before every deploy

Fly's GitHub integration builds and ships whatever you push. If you would
rather a red test suite blocked the deploy, use a GitHub Actions workflow
instead of (not alongside) Fly's integration, or the two will both deploy.
Ask and I'll add `.github/workflows/fly-engine.yml`, which runs the 62 tests
first and only then calls `flyctl deploy ./engine --remote-only`.

---

## Running it

```bash
fly logs                       # live
fly ssh console                # a shell on the machine
fly scale show                 # what you are paying for
fly scale vm performance-4x    # renders feel slow
fly volumes extend <id> -s 25  # running out of disk
```

**Cost.** The machine is the bulk of the bill, plus Tigris storage and egress.
Fly bills the machine per second that it runs, so what you pay depends far
more on whether it sleeps than on how big it is — see below. Check Fly's
current pricing before committing.

## Paying only for the hours you use

Left alone, a Fly machine runs every second of the month whether anyone uses
it or not. The Engine instead stops itself once it has been quiet, and Fly's
proxy starts it again the next time the app calls it. A machine used an hour a
day is billed for an hour a day.

```bash
fly machine list               # "stopped" is the state you want when idle
fly logs                       # look for: sleeping: idle for 604s ...
```

Three settings make it work, and all three are already in `fly.toml`:

| setting | value | why |
| --- | --- | --- |
| `IDLE_SHUTDOWN_S` | `600` | quiet minutes before sleeping; `0` runs it 24/7 |
| `auto_start_machines` | `true` | the next request wakes it |
| `min_machines_running` | `0` | nothing to wake up if Fly keeps one running |

**It will not sleep on top of your work.** The decision is made by the Engine,
not by Fly, precisely because Fly cannot see a render. `app/idle.py` refuses to
sleep while any job, import or export is queued or processing, while an asset
is still importing, or while a finished clip still owes the app a webhook.
A job parked at `awaiting_confirmation` is the one exception: that waits on a
person, who may not come back for days.

**What you will notice.** The first call after a sleep waits a few seconds for
the machine to boot. `engineClient` in the app expects this and retries a
refused connection or a 503 three times before reporting a problem, so a cold
start looks like a slow click rather than an error.

**Change the timeout** without a redeploy:

```bash
fly secrets set IDLE_SHUTDOWN_S=1800    # half an hour
fly secrets set IDLE_SHUTDOWN_S=0       # stay up around the clock
```

A browser tab left open on a page that polls the Engine counts as use and will
keep it awake. Close the tab when you are done for the day.

**The volume is billed either way.** Disk is charged per GB-month whether the
machine runs or not, so a 10GB volume costs the same while asleep. Only the
CPU and RAM stop.

**Scaling.** One machine processes jobs one at a time. For more throughput:

```bash
fly scale count 2
```

Each machine needs its own volume, and each runs its own worker. Jobs are
claimed from the database, so they will not collide.

## When YouTube says "sign in to confirm you're not a bot"

YouTube scores the address a request comes from, and a cloud machine's address
scores badly. The same video your browser plays without a thought can be
refused to the Engine. The image already does everything that can be done
from this side: it mints a PO token locally, solves YouTube's JavaScript
challenge with Node, uses IPv4 only, and tries several player clients before
giving up. No account and no cookies are involved.

If a link is still refused, there are two reliable ways out.

**A residential proxy.** This is the real fix: it gives requests an address
that is not a datacentre. Any residential provider works.

```bash
fly secrets set YTDLP_PROXY="http://user:pass@host:port"
```

**It is only used on videos YouTube refuses.** Residential bandwidth is sold
by the gigabyte and a video is most of one, so routing every download through
it would be the largest line on the bill — several times the machine itself.
The Engine therefore tries every player client on its own address first, and
only falls back to the proxy once YouTube has refused all of them. Most videos
never touch it, so most videos cost nothing.

A failed attempt transfers almost nothing, so the gigabytes are only spent on
the attempt that actually works. An error that is *not* a refusal — a private
video, a dead link — stops the whole thing immediately rather than paying to
be told the same thing again.

Buy credit that does not expire rather than a monthly plan: at a few videos a
day only a fraction of them need the proxy, so a small top-up lasts. Watch for
`fetched ... through the proxy after a refusal` in `fly logs` to see how often
it is actually used.

If YouTube ever starts refusing this machine for *everything*, trying direct
first is just a slow way to fail. Skip it:

```bash
fly secrets set YTDLP_PROXY_ALWAYS=1     # back to normal: unset it
```

**Upload the file instead.** Download the video yourself and upload it in the
Library. Nothing is asked of YouTube, so nothing can be refused.

A cookies file is a third option and the worst one. Put a `cookies.txt` at
`/data/cookies.txt` on the volume and the Engine will use it. The cookies
expire within weeks, and the Google account that exported them can be
rate-limited or locked for being used from a server — so never use your own
account for this.

## Faster transcription with Groq

Transcribing on the Engine's own CPU is the slow part of a job: minutes for a
long video. Groq runs the same Whisper family on their hardware at a couple of
hundred times real time, and at `whisper-large-v3-turbo` rather than the
`small` model this machine can afford. A 20-minute video costs about 1.3 cents
and comes back in seconds.

```bash
fly secrets set GROQ_API_KEY="gsk_..."
```

That is the whole change. With a key set the Engine uses Groq; without one it
uses its own CPU, and it falls back to the CPU on its own if Groq is
rate-limited or down. To check which is live:

```
GET /v1/health   ->   "transcribe_provider": "groq" | "faster-whisper"
```

To pin it either way, set `TRANSCRIBE_PROVIDER` to `groq` (fail loudly if Groq
is unreachable) or `faster-whisper` (never leave the machine). Audio leaves the
Engine when Groq is in use, which is the trade being made.
