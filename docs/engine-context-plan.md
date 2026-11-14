# Engine contextual awareness: improvement plan

Goal: the Engine recognises what kind of video it is cutting (broadcast panel,
two-way remote interview, podcast studio, talking head, screen share, vlog,
faceless B-roll) and picks the edit style that format's own editors use,
instead of treating every picture as "faces in a frame".

Test video for this work: "'WHY Won't You Answer The Question?!' Lindsey Graham
Allegations + Liz Truss Interview" (Piers Morgan Uncensored, YouTube
OgN8CHAVbOc, 1:29:16). Its arrangements: one guest full frame (0:00), a 2-box
split (11:15), a 5-box row of guests (15:00-41:00), 4 and 3 boxes (41:15,
45:00), then a 2-box studio + remote interview (48:45-end), all on an
animated background with a "PIERS MORGAN UNCENSORED" logo and a ticker.

## Done (15 Nov, this session)

1. `engine/app/pipeline/panels.py`: finds broadcast boxes from borders that
   hold still while the inside moves (no model). `by_shot` reads them per
   stretch between camera cuts, since the line-up changes. Verified on the
   test video: 5, 4 and 3 boxes found exactly.
2. `shots._panel_shots`: in a panel programme, the speaker's box fills the
   top card and the person they are answering the box below (no background,
   ticker or slivers of other boxes); the cards change with the speaker
   (`_panel_turns`, held 2.5 s+) though the broadcast never cuts. Everyone /
   grid / nobody named: the line-up row by row, or the whole picture.
3. `GET /framing` returns `panels` per stretch.
4. Fix: `keep_text_whole` slides a moving crop at most 5% of the width (a
   ticker pushed a crop right off the guest).

## To do (for Opus 5.5 High)

### A. Panel framing, finish
- **Tall boxes**: with 4-5 narrow portrait boxes the 2-card stack upscales a
  box 3-4.7x and is soft. When the speaker's box is portrait (w/h < 0.75),
  give it the whole 9:16 frame (its shape matches) and show the other person
  as a pip bubble; keep 2-card stacks for landscape boxes (2-3 per row).
- **2-box failures**: one 2-box sample (at 52:30) was missed. Likely the
  studio box has no drawn border on one side. Accept a box with 3 strong
  sides when its 4th side is the frame edge or another panel's side.
- **Browser mirror**: the Studio preview (LivePreview, lib/clip-render) draws
  `split` cells already; check the panel cells render the same, and add
  `panels` to the app's ShotPlan type.
- **Speaker in tiny boxes**: mouth motion in 200 px boxes is unreliable.
  Weight turns with voice activity per box (vad spans + mouth motion inside
  that box only) and require a margin before swapping cards.
- Tests: synthetic frames with 2/3/5 bordered boxes on a moving background
  (`panels.from_frames`), plus `_panel_shots` card order with fake turns.

### B. Format classifier (the "contextual awareness" itself)
Add `engine/app/pipeline/format.py`: classify each clip (and the whole video)
into one of: `panel_broadcast`, `remote_interview` (2 boxes), `studio_podcast`
(2-3 people, real room, mics), `talking_head`, `screen_share`, `vlog_handheld`,
`b_roll` (faceless), `stage_event`, `news_package`. Signals, all already
computed: panels count over time, face count/size, cuts per minute, voiced
share, on-screen text (tickers, lower thirds at y > 0.8), activity and camera
shift (detail indices 5-8), letterbox. Rules first, scored; store as
`project.framing.format` and in the style review profile.

### C. Format-driven edit recipes
For each format, a recipe the style review applies before VIBES ranking:
- panel_broadcast: panel cards (A), hide tickers/logos, captions on the seam.
- remote_interview: split by box, speaker on top; fullscreen speaker on long
  monologues (> 20 s).
- studio_podcast: follow the speaker with reaction cut-ins (pip) on laughs.
- talking_head: follow, punch-ins on stressed words.
- screen_share: presenter look (exists).
- vlog/b_roll: fit or follow action (exists), never split.
Owner-chosen layouts still win; learned style recipes (style-recipes.ts) are
stored per format as well as per vibe.

### D. Broadcast furniture
Detect persistent logos/tickers/lower thirds (text or graphics that hold still
in the bottom 20% or a corner across shots) and treat them as furniture:
never centre on them, crop them out where the frame allows, never let them
push a crop (see the keep_text_whole fix).

### E. Verification loop
Use the scratchpad review tools (contact sheets of every shot switch, source
beside output) on the test video's 5 arrangements after each change; add a
`tools/benchmark.py` scene for a 5-box panel and a 2-box remote interview
with criteria: speaker's box on screen >= 90% of talk time, no background or
ticker pixels in cards, upscale <= 3x.
