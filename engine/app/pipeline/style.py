"""The style review: does each clip's look suit what the clip actually shows?

A job used to give every clip the same layout policy, so a two-person
podcast moment, a screen recording and a drone shot of a house all came out
"following the speaker". After cutting, the Engine now looks at each clip on
its own, from the same analysis the render uses (faces, bodies, talk turns,
cuts, on-screen text, activity), and:

1. describes it — the clip's "vibe": two people talking back and forth, a
   group, a screen with a speaker, one person to camera, narrated footage,
   action, wide scenes, or a mix;
2. picks the layout that suits that vibe, and proves it by planning the clip
   in that layout and measuring how much of it really gets the look (a split
   that only applies to two seconds of a clip is not a split-screen clip);
3. honours the owner: a layout they chose, or asked for in their own words,
   is kept; when it can't apply to much of the clip the review says so in
   plain words and names what would suit it instead, so Co-Work can tell them.

Everything here is arithmetic over the shot plan's own inputs: no extra
decoding, and a failure leaves the clip exactly as it was.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, replace

from . import checks, director
from . import shots as P

VERSION = 1

#: The look each layout gives, by the shot kinds that carry it.
SIGNATURE: dict[str, set[str]] = {
    "full-video": {"fill"},
    "split": {"split"},
    "grid": {"grid"},
    "screen": {"screen", "graphic"},
    "pip": {"pip"},
    "streamer": {"fit"},
    "black-box": {"bars"},
    "title-subtitles": {"headline"},
}
#: Layouts that are always what they say (the picture whole), whatever is in it.
WHOLE_PICTURE = {"streamer", "black-box", "title-subtitles"}
#: The owner's names for the layouts (as the catalog shows them).
NAMES = {
    "auto": "Let the Engine choose", "full-video": "Follow the speaker", "split": "Split screen",
    "grid": "Group grid", "screen": "Screen + speaker", "pip": "Picture-in-picture",
    "streamer": "Blurred background", "black-box": "Black bars", "title-subtitles": "Headline + captions",
}
#: What a layout needs in the picture, finishing "…needs …".
NEEDS = {
    "full-video": "someone or something to follow",
    "split": "two people sitting apart in the same shot",
    "grid": "three or four people in the same shot",
    "screen": "a screen, slides or gameplay, or a small camera face over a wide picture",
    "pip": "a second face big enough to read",
}
#: A layout suits a clip when at least this share of it gets the layout's look.
MIN_FIT = 0.4
#: A person counts as one of the clip's talkers with this share of the named talk.
TALKER_SHARE = 0.15
TALKER_MIN_MS = 1500

#: The clip's vibe, in the owner's words, and the layouts that suit it best first.
VIBES: dict[str, tuple[str, list[str]]] = {
    "conversation": ("Two people talking back and forth", ["split", "pip", "auto"]),
    "group": ("A group, with several people talking", ["grid", "auto", "streamer"]),
    "screen_speaker": ("A screen, slides or gameplay, with the speaker on camera", ["screen", "pip", "auto"]),
    "screen": ("A screen recording, slides or graphics", ["screen", "streamer", "auto"]),
    "reaction": ("One person talking while the other reacts", ["pip", "split", "auto"]),
    "interview": ("Two people in the shot, one doing the talking", ["full-video", "pip", "auto"]),
    "together": ("Two people close together in one frame", ["full-video", "auto"]),
    "talking_head": ("One person talking to camera", ["full-video", "auto"]),
    "narrated": ("Footage with someone talking over it", ["title-subtitles", "streamer", "auto"]),
    "action": ("Action: people or things moving", ["full-video", "auto", "streamer"]),
    "wide": ("Wide scenes: places, crowds or views", ["streamer", "title-subtitles", "black-box"]),
    "mixed": ("A mix that changes from shot to shot", ["auto", "title-subtitles", "streamer"]),
}
#: Why that layout suits that vibe, said to the owner.
WHY = {
    ("conversation", "split"): "both people are on screen and both talk, so each gets their own half and nobody is cut out",
    ("conversation", "pip"): "the speaker fills the frame with the other person in a bubble",
    ("group", "grid"): "three or four people share the shot and several talk, so each gets a cell",
    ("screen_speaker", "screen"): "the screen goes on top so it can be read, with the speaker's camera below",
    ("screen", "screen"): "the whole screen shows on top with a close-up of the busy part below, so it reads on a phone",
    ("screen", "streamer"): "the whole screen shows over a blur, nothing cropped off",
    ("reaction", "pip"): "the speaker fills the frame and the reaction stays in a bubble",
    ("reaction", "split"): "both faces stay on screen, one above the other",
    ("interview", "full-video"): "one person carries the talk, so the crop holds on them and re-aims when the other speaks",
    ("together", "full-video"): "they fit in one frame, so the crop holds both",
    ("talking_head", "full-video"): "one person talks to camera, so the crop holds on them",
    ("narrated", "title-subtitles"): "the picture shows whole with the headline above and the words below, so the story carries it",
    ("narrated", "streamer"): "the picture shows whole over a blur, with the words carrying the story",
    ("action", "full-video"): "the crop follows the person or the movement through each shot",
    ("wide", "streamer"): "cropping would cut the scene apart, so the whole picture shows over a blur",
    ("wide", "title-subtitles"): "the whole picture shows with the headline above",
    ("wide", "black-box"): "the whole picture shows with black above and below",
}
GENERIC_WHY = {
    "auto": "each shot gets its own look: follow the speaker, both people stacked, or a screen shown whole",
    "full-video": "the crop follows whoever is talking",
    "split": "two people get a cell each",
    "grid": "everyone gets a cell",
    "screen": "the screen goes on top with the speaker below",
    "pip": "the speaker fills the frame with the other face in a bubble",
    "streamer": "the whole picture shows over a blur",
    "black-box": "the whole picture shows with black above and below",
    "title-subtitles": "the picture shows whole with the headline above and the words below",
}


@dataclass
class Profile:
    """What a clip shows, as shares of its length (they add up to about 1)."""
    length_ms: int = 0
    one: float = 0.0            # one person
    together: float = 0.0       # two or more who fit one crop (or a second face too small to pair)
    pair: float = 0.0           # two comparable people sitting apart
    group: float = 0.0          # three or more comparable people
    crowd: float = 0.0          # several people too small to give a cell each
    screen: float = 0.0         # a flat, still picture edge to edge: slides, a screen, graphics
    screen_face: float = 0.0    # a small camera face in a corner over such a picture
    body: float = 0.0           # a person with no face to read (back turned, walking away)
    action: float = 0.0         # nobody, but the movement is in one place
    scene: float = 0.0          # nobody, and nothing in particular: a view, a room
    title: float = 0.0          # a title card on screen
    second_face: float = 0.0    # a readable second face present (what a picture-in-picture needs)
    talkers: int = 0            # people with a real share of the talk
    switches_per_min: float = 0.0
    speech: float = 0.0         # share of the clip with words spoken
    cuts_per_min: float = 0.0

    def as_dict(self) -> dict:
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def profile(inp: P.Inputs) -> Profile:
    """Walk the clip shot by shot, the way the plan does, and add up what each shows."""
    start, end = inp.in_ms, inp.out_ms
    length = max(1, end - start)
    pr = Profile(length_ms=length)
    fw, _ = P.full_window(inp.width, inp.height, inp.out_w, inp.out_h)
    share = fw / max(1, inp.width)
    add: dict[str, int] = {}

    for a, b in P._split_on_presence(inp, director.shots(inp.cuts, start, end)):
        d = b - a
        bodies = P._bodies_in(inp, a, b)
        faces = P._real_faces(P._faces(director.people_in(inp.tracks, a, b)), bodies, inp)
        if len([f for f in faces if f.w >= P.PIP_MIN_FACE_W]) >= 2:
            add["second_face"] = add.get("second_face", 0) + d
        if P._is_title(P._titles_in(inp, a, b)):
            kind = "title"
        else:
            wide, _centre = P._detail(inp, a, b, share)
            if not faces:
                act = P._activity_profile(inp, a, b)
                bright = P._brightness(inp, a, b)
                still = (act is None or act[1] < P.STILL_SCREEN_MOTION) and (bright is None or bright >= P.DARK_PICTURE)
                if bodies:
                    kind = "body"
                elif wide and still:
                    kind = "screen"
                else:
                    where = P._activity_centre(inp, a, b, share) if act is not None else None
                    kind = "action" if where is not None and where[1] >= P.ACTIVITY_LEAD else "scene"
            elif len(faces) == 1 and faces[0].w < P.SMALL_FACE_W and wide and P._in_corner(faces[0]):
                kind = "screen_face"
            else:
                comparable = P._comparable(faces, inp)
                fits = director._fits(min(f.left for f in faces), max(f.right for f in faces), share)
                if len(faces) >= 3 and not fits and P._too_small_to_split(faces, inp):
                    kind = "crowd"
                elif len(comparable) >= 3:
                    kind = "group"
                elif len(comparable) >= 2 and not P._pair_fits(comparable[:2], share):
                    kind = "pair"
                elif len(faces) >= 2:
                    kind = "together"
                else:
                    kind = "one"
        add[kind] = add.get(kind, 0) + d

    for k, ms in add.items():
        setattr(pr, k, ms / length)

    talk: dict[int, int] = {}
    named = 0
    last = None
    switches = 0
    for t in sorted(inp.turns or [], key=lambda t: t.start_ms):
        a, b = max(start, t.start_ms), min(end, t.end_ms)
        if b <= a or t.track_id is None:
            continue
        talk[t.track_id] = talk.get(t.track_id, 0) + (b - a)
        named += b - a
        if last is not None and t.track_id != last:
            switches += 1
        last = t.track_id
    pr.talkers = sum(1 for ms in talk.values() if ms >= TALKER_MIN_MS and ms >= TALKER_SHARE * max(1, named))
    minutes = length / 60000
    pr.switches_per_min = switches / minutes
    pr.cuts_per_min = len([c for c in inp.cuts if start < c < end]) / minutes
    pr.speech = _speech_share(inp.words or [], length)
    if getattr(inp, "voiced", None) is not None:
        # Words over music are lyrics or the transcriber guessing: only voiced time counts.
        pr.speech = min(pr.speech, float(inp.voiced))
    return pr


def _speech_share(words: list, length_ms: int) -> float:
    """Share of the clip with a word being spoken (words in any one timeline)."""
    spans = sorted((int(w.get("start_ms", 0)), int(w.get("end_ms", 0))) for w in words
                   if isinstance(w, dict) and w.get("end_ms", 0) > w.get("start_ms", 0))
    covered, cur_a, cur_b = 0, None, None
    for a, b in spans:
        b = max(b, a)
        if cur_b is None or a > cur_b + 400:      # a pause under 0.4 s is still talking
            if cur_b is not None:
                covered += cur_b - cur_a
            cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    if cur_b is not None:
        covered += cur_b - cur_a
    return min(1.0, covered / max(1, length_ms))


def vibe_of(pr: Profile, focus: str = "auto", has_title: bool = True) -> str:
    """The one thing this clip mostly is."""
    screen = pr.screen + pr.screen_face
    if screen >= 0.45:
        return "screen_speaker" if pr.screen_face >= 0.15 or (pr.one + pr.together) >= 0.15 else "screen"
    if pr.group >= 0.4 and (pr.talkers >= 3 or focus in P.WANTS_EVERYONE or pr.switches_per_min >= 6):
        return "group"
    if pr.pair >= 0.35:
        if pr.talkers >= 2 or focus == "everyone":
            return "conversation"
        if focus == "reaction":
            return "reaction"
        return "interview"
    if pr.together >= 0.4 and focus == "reaction" and pr.second_face >= 0.4:
        return "reaction"
    visual = pr.scene + pr.crowd + pr.action + pr.body + pr.title
    if visual >= 0.55:
        if pr.speech >= 0.6 and has_title:
            return "narrated"
        if pr.action + pr.body >= pr.scene + pr.crowd:
            return "action"
        return "wide"
    if pr.one >= 0.6:
        return "talking_head"
    if pr.together >= 0.5:
        return "together"
    return "mixed"


def fit_of(plan: list[P.Shot], layout: str) -> float:
    """Share of the planned clip that gets this layout's look."""
    if layout in WHOLE_PICTURE or layout == "auto":
        return 1.0
    total = sum(s.length_ms for s in plan) or 1
    kinds = SIGNATURE.get(layout, set())
    return sum(s.length_ms for s in plan if s.kind in kinds) / total


#: The owner's own words for a look, as said in a clipping request.
REQUEST_WORDS: list[tuple[str, str]] = [
    (r"\bblack bars?\b|\bletter ?box", "black-box"),
    (r"\bblur(red|ry)? (back ?ground|bg)\b|\b(show|keep) the whole (picture|frame|video)\b|\bno crop|\bdon'?t crop|\buncropped\b", "streamer"),
    (r"\bheadline (and|\+|&|with) captions?\b|\bpodcast poster\b|\btitle (on top|above)\b", "title-subtitles"),
    (r"\bpicture[- ]in[- ]picture\b|\bpip\b|\binset\b|\breaction bubble\b", "pip"),
    (r"\bgroup grid\b|\bgrid\b", "grid"),
    (r"\bsplit[- ]?screen\b|\bside[- ]by[- ]side\b|\bstack(ed)? (them|both|the two)\b|\bboth (people|speakers|of them) on screen\b", "split"),
    (r"\bscreen ?(share|recording|\+ ?speaker)\b|\bgameplay\b|\bslides\b|\bslideshow\b|\bpresentation\b|\btutorial\b", "screen"),
    (r"\bfollow the speaker\b|\bfull[- ]screen\b|\bfill the (screen|frame)\b|\bclose[- ]ups?\b", "full-video"),
]


def requested_from(prompt: str) -> "str | None":
    """A layout the owner named in their clipping request, if any (the first one named wins)."""
    text = (prompt or "").lower()
    if not text:
        return None
    hits = []
    for pattern, layout in REQUEST_WORDS:
        m = re.search(pattern, text)
        if m:
            hits.append((m.start(), layout))
    return min(hits)[1] if hits else None


def _pct(x: float) -> int:
    return int(round(100 * max(0.0, min(1.0, x))))


def _describe(pr: Profile) -> str:
    """A short, plain account of what the clip shows."""
    parts = []
    people = {"one person": pr.one, "two people apart": pr.pair, "two people together": pr.together,
              "a group": pr.group, "a crowd": pr.crowd, "a screen or slides": pr.screen + pr.screen_face,
              "someone with their back turned or moving": pr.body, "action with nobody's face": pr.action,
              "a view or a room": pr.scene, "a title card": pr.title}
    for name, v in sorted(people.items(), key=lambda kv: -kv[1]):
        if v >= 0.15:
            parts.append(f"{name} {_pct(v)}%")
    if pr.talkers:
        parts.append(f"{pr.talkers} {'person talks' if pr.talkers == 1 else 'people talk'}")
    parts.append(f"talking {_pct(pr.speech)}% of the time")
    return ", ".join(parts[:5])


def learned_layouts(raw: object) -> dict[str, str]:
    """A business's learned layout per vibe (from the app's style recipes), valid entries only."""
    if not isinstance(raw, dict):
        return {}
    return {v: l for v, l in raw.items() if v in VIBES and isinstance(l, str) and l in NAMES}


def review(inp: P.Inputs, *, requested: "str | None" = None, request_source: "str | None" = None,
           has_title: bool = True, plan_auto: "list[P.Shot] | None" = None,
           learned: "dict[str, str] | None" = None) -> dict:
    """The review of one clip: its vibe, the layout it should use, and how well each fits.

    `inp` is the plan's inputs for the clip (any layout; it is replaced per
    candidate). `requested` is a layout the owner chose or named; it is kept.
    `learned` is the layout this business usually ends up with for each vibe
    (style recipes): it goes first when this clip can take it, otherwise the
    Engine's own pick stands and the note says why.
    """
    pr = profile(inp)
    vibe = vibe_of(pr, inp.focus, has_title)
    label, ranked = VIBES[vibe]

    plans: dict[str, list[P.Shot]] = {}

    def plan_in(layout: str) -> list[P.Shot]:
        if layout not in plans:
            plans[layout] = plan_auto if (layout == "auto" and plan_auto is not None) else \
                P.plan(replace(inp, layout=layout))
        return plans[layout]

    fits: dict[str, float] = {}
    for layout in list(SIGNATURE) + ["auto"]:
        fits[layout] = round(fit_of(plan_in(layout), layout), 3)

    candidates = [l for l in ranked if l == "auto" or l in WHOLE_PICTURE or fits.get(l, 0) >= MIN_FIT]
    if "title-subtitles" in candidates and not has_title:
        candidates.remove("title-subtitles")
    suggested = candidates[0] if candidates else "auto"
    why = WHY.get((vibe, suggested), GENERIC_WHY.get(suggested, ""))
    if suggested == "auto" and ranked[0] != "auto":
        why = f"{NAMES[ranked[0]]} would only apply to {_pct(fits.get(ranked[0], 0))}% of it, so " + GENERIC_WHY["auto"]

    layout, picked_by, note = suggested, "engine", None
    usual = (learned or {}).get(vibe)
    usual_fits = bool(usual) and (usual == "auto" or usual in WHOLE_PICTURE or fits.get(usual, 0) >= MIN_FIT)         and not (usual == "title-subtitles" and not has_title)
    if usual and usual_fits:
        if usual != suggested:
            why = f"it's the look you usually pick for clips like this ({label.lower()})"
        suggested, layout, picked_by = usual, usual, "learned"
    elif usual and usual in NAMES:
        note = (f"You usually pick {NAMES[usual]} for clips like this, but it needs {NEEDS.get(usual, 'a different picture')}"
                f" and only {_pct(fits.get(usual, 0))}% of this one has that, so it got {NAMES[suggested]}.")
    want = requested if requested in NAMES else None
    if want and want != "auto":
        layout, picked_by, note = want, "owner", None
        f = fits.get(want, 1.0)
        if want in NEEDS and f < MIN_FIT:
            fallback = "the rest follows the speaker" if want != "full-video" else "the rest shows the picture as it is"
            note = (f"You asked for {NAMES[want]}, which needs {NEEDS[want]}; that's only {_pct(f)}% of this clip, "
                    f"so {fallback}.")
            if suggested != want:
                note += f" {NAMES[suggested]} suits it better: {why}."
        elif suggested != want and ranked[0] != want and want not in ranked:
            note = f"Kept {NAMES[want]} as you asked. {NAMES[suggested]} would also suit it: {why}."

    alternatives = []
    for l in candidates:
        if l == layout:
            continue
        alternatives.append({"layout": l, "name": NAMES[l], "fit": fits.get(l, 1.0),
                             "why": WHY.get((vibe, l), GENERIC_WHY.get(l, ""))})
        if len(alternatives) >= 2:
            break

    chosen_plan = plan_in(layout)
    subject = checks.subject_in_frame(chosen_plan, replace(inp, layout=layout))
    sliced = checks.text_sliced(chosen_plan, replace(inp, layout=layout))
    return {
        "version": VERSION,
        "vibe": vibe, "vibe_label": label, "described": _describe(pr),
        "layout": layout, "name": NAMES[layout], "picked_by": picked_by,
        "suggested": suggested, "why": why if picked_by != "owner" else WHY.get((vibe, layout), GENERIC_WHY.get(layout, "")),
        "requested": want, "request_source": request_source if want else None,
        "learned": usual if usual in NAMES else None,
        "fit": fits.get(layout, 1.0), "note": note,
        "alternatives": alternatives, "fits": fits,
        "checks": {"subject_in_frame": None if subject is None else round(subject, 3),
                   "text_sliced": None if sliced is None else round(sliced, 3)},
        "profile": pr.as_dict(),
        "stale": False,
    }


def for_render(render, **kw) -> dict:
    """Review the clip a render describes (compose.Render), from the analysis the render itself uses.

    The clip is planned once with "auto" for its inputs (the analysis is
    cached by source and range, so the export that follows pays nothing more).
    """
    from . import compose

    plan, inputs = compose.plan_for(replace(render, layout="auto"))
    return review(inputs, plan_auto=plan, **kw)


def review_project(project, source_path, *, requested: "str | None" = None,
                   request_source: "str | None" = None, learned: "dict[str, str] | None" = None) -> dict:
    """Review a stored clip (models.Project) cut from the file at `source_path`."""
    from . import exports

    render = exports.render_for(project, source_path, source_path.with_suffix(".review.mp4"))
    title = (project.title or {})
    has_title = bool(str(title.get("text") or "").strip()) and title.get("enabled", True) is not False
    return for_render(render, requested=requested, request_source=request_source, has_title=has_title,
                      learned=learned)


def requested_for_job(params: dict) -> "tuple[str | None, str | None]":
    """The layout the owner asked for when they started the job, and where they said it."""
    formats = params.get("formats") or []
    chosen = formats[0] if formats else None
    if chosen and chosen != "auto":
        return chosen, "options"
    spoken = requested_from(params.get("prompt", ""))
    if spoken:
        return spoken, "request"
    return None, None


def summary(reviews: list[dict]) -> dict:
    """A job's looks at a glance: how many clips got each layout, and the notes for the owner."""
    counts: dict[str, int] = {}
    notes = []
    for i, r in enumerate(reviews, start=1):
        if not r:
            continue
        counts[r["name"]] = counts.get(r["name"], 0) + 1
        if r.get("note"):
            notes.append({"index": r.get("index", i), "note": r["note"]})
    return {"layouts": counts, "notes": notes}
