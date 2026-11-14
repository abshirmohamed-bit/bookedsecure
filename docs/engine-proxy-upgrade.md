# Upgrading the video Engine's YouTube proxy

YouTube refuses downloads from Fly's data-centre address, so the Engine
(`engine/`, Fly app `crayzmundo-engine`) fetches YouTube links through a proxy
set in one secret, `YTDLP_PROXY`. A **residential** plan (DataImpulse today)
borrows other people's home connections: cheap, but slow (often 0.1–1 MB/s),
and YouTube flags an address that downloads a lot. An **ISP** plan (also called
"static residential") gives you your own addresses on business-grade lines that
sites still treat as home internet: much faster and steadier, and trusted for
longer.

## The reminder

BookedSecure tells platform admins, at most once a week, when it's time to
upgrade. It fires when any of these held over the last 7 days:

| Trigger | Why it matters |
|---|---|
| 3+ link imports or clip jobs failed on YouTube's bot check ("Sign in to confirm you're not a bot") or a 403 refusal | the proxy's addresses are being refused |
| average download speed through the proxy under 0.3 MB/s (from at least two downloads over 5 MB) | long videos take far too long |
| 20+ long YouTube links (10 min+) clipped | the volume at which residential addresses start getting flagged |

Where to see it: a notification (Account filter) on each platform admin's
workspace, and the "Video Engine YouTube proxy" line in the control room
(`/admin/overview`).

How it works: the Engine records every yt-dlp try in its own database
(`proxy_downloads`: outcome, direct or proxy, sticky/rotating from the port,
bytes, seconds; `engine/app/pipeline/proxy_health.py`) and serves the week's
summary at `GET /v1/proxy/health` (API key required). BookedSecure's follow-ups
hook reads it only when Fly says the Engine is already running, with
`wake: false`, so a sleeping Engine is never woken for this
(`src/lib/engine-proxy(.server).ts`).

## Several proxies, switched automatically

The Engine can hold more than one proxy: `YTDLP_PROXY` is the first, and
`YTDLP_PROXIES` adds more (separated by commas), e.g. the 2-5 addresses of an
ISP plan, or a second provider kept as a spare. Downloads use the healthiest
first (`engine/app/pipeline/proxy_pool.py`):

- a proxy YouTube refuses 3 times in a row is benched for 30 minutes (doubling
  each time it happens again, up to a day) and the others take over;
- a proxy whose plan is out of data (407 TRAFFIC_EXHAUSTED) is benched for 6
  hours and the next one is tried straight away;
- a download that works clears the record, and faster proxies go first;
- a benched proxy is still tried last, never refused outright.

The control room lists each proxy (host and port only) as in use or benched,
with its successes, refusals and speed. The reminder also fires when every
proxy is benched. To add a spare: Fly, crayzmundo-engine, Secrets, set
`YTDLP_PROXIES` to `http://USER:PASS@HOST:PORT,http://USER:PASS@HOST2:PORT`,
then Deploy Secrets.

## How to switch

1. Buy an ISP / static residential plan. Ask for Australian addresses (the
   Engine runs in Sydney) and HTTP(S) proxies with username and password.
   Providers that sell them:
   - **IPRoyal**: "Static Residential" (ISP), priced per IP per month with unlimited traffic
   - **Webshare**: "Static Residential", per IP, traffic included up to a quota
   - **Decodo** (formerly Smartproxy): "ISP proxies", per IP
   - **Oxylabs**: "ISP proxies", per IP
   - **Bright Data**: "ISP proxies", per IP plus per GB
   - **DataImpulse**: check its current product list; at the time of writing it
     sells residential, mobile, datacenter and "residential premium", not ISP.

   Compare per-IP against per-GB pricing: a 1-hour 1080p video is about 0.6 GB,
   so plans with unlimited or large traffic per IP suit video downloading. A
   handful of addresses (2–5) is plenty to start.
2. On Fly: **crayzmundo-engine → Secrets → `YTDLP_PROXY`**, set it to the new
   proxy as `http://USERNAME:PASSWORD@HOST:PORT` (from the provider's
   dashboard), then **Set secret** and **Deploy Secrets**. That is the only
   change; no code or BookedSecure setting changes.
3. Clip one long YouTube link. The control room line shows the new speed once
   the Engine has been awake.

To go back, set `YTDLP_PROXY` to the old value the same way.
