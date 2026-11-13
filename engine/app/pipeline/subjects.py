"""People and on-screen text, as the small models OpenCV can run on a CPU.

Faces were the Engine's only idea of a person. Anyone filmed from behind, in
profile, walking across the frame or laughing with their head thrown back was
"nobody in shot", and the crop went to the middle of the picture or, worse,
to a kettle the face detector took for a face. And nothing knew about the
words burned into the picture, so name labels, title cards and the video's
own captions were sliced down the middle.

Two detectors fix most of that, both run through cv2.dnn in the decode pass
the Engine already makes:

  * NanoDet (opencv_zoo object_detection_nanodet, 3.8 MB, ~20 ms a frame):
    whole-body person boxes, plus cars, dogs and the rest of COCO, so a
    detailing video knows where the car is.
  * PP-OCRv3 DB (opencv_zoo text_detection_ppocr, 2.4 MB, ~40 ms a frame):
    boxes around text in the picture.

Both are optional: without the model files the Engine behaves exactly as it
did. Boxes are (x, y, w, h) as shares of the frame, like the face tracks.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("engine.subjects")

DEFAULT_OBJECT_MODEL = "/models/object_detection_nanodet.onnx"
DEFAULT_TEXT_MODEL = "/models/text_detection_ppocr.onnx"
COCO = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
        "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
        "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
        "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
        "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
        "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
        "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
        "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
        "scissors", "teddy bear", "hair drier", "toothbrush"]
#: NanoDet's input side, its anchor strides and the bins of its box regression.
NANODET_SIZE = 416
NANODET_STRIDES = (8, 16, 32)
NANODET_REG_MAX = 7
#: A detection below this is noise; people are kept down to a lower score than
#: objects, because a half-hidden person still matters to the framing.
PERSON_MIN_SCORE = 0.35
OBJECT_MIN_SCORE = 0.45
#: Text detection runs on a frame this wide; DB wants multiples of 32.
TEXT_W = 736
TEXT_MIN_SCORE = 0.5

_object_net = None
_text_net = None
_object_missing = False
_text_missing = False


def object_model_path() -> str:
    return os.environ.get("OBJECT_MODEL_PATH", DEFAULT_OBJECT_MODEL)


def text_model_path() -> str:
    return os.environ.get("TEXT_MODEL_PATH", DEFAULT_TEXT_MODEL)


def _load_objects():
    global _object_net, _object_missing
    if _object_net is not None or _object_missing:
        return _object_net
    path = object_model_path()
    try:
        import cv2
        if not Path(path).exists():
            raise FileNotFoundError(path)
        _object_net = cv2.dnn.readNet(path)
    except Exception as e:  # noqa: BLE001 - the Engine works without it
        _object_missing = True
        log.info("object detector not available (%s); people are faces only", e)
    return _object_net


def _load_text():
    global _text_net, _text_missing
    if _text_net is not None or _text_missing:
        return _text_net
    path = text_model_path()
    try:
        import cv2
        if not Path(path).exists():
            raise FileNotFoundError(path)
        det = cv2.dnn_TextDetectionModel_DB(path)
        det.setBinaryThreshold(0.3).setPolygonThreshold(TEXT_MIN_SCORE).setMaxCandidates(100).setUnclipRatio(2.0)
        _text_net = det
    except Exception as e:  # noqa: BLE001
        _text_missing = True
        log.info("text detector not available (%s); on-screen text is not read", e)
    return _text_net


def objects_available() -> bool:
    return _load_objects() is not None


def text_available() -> bool:
    return _load_text() is not None


def _softmax(x):
    import numpy as np

    e = np.exp(x - x.max(-1, keepdims=True))
    return e / e.sum(-1, keepdims=True)


_CENTRES = None


def _centres():
    """Anchor centres (x, y, stride) for every NanoDet output row, in input px."""
    global _CENTRES
    if _CENTRES is None:
        import numpy as np

        parts = []
        for s in NANODET_STRIDES:
            n = NANODET_SIZE // s
            ys, xs = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
            parts.append(np.stack([xs.ravel() * s, ys.ravel() * s, np.full(n * n, s)], 1))
        _CENTRES = np.concatenate(parts).astype("float32")
    return _CENTRES


def detect_objects(bgr) -> list[tuple[str, float, float, float, float, float]]:
    """(label, score, x, y, w, h) for the people and things in one BGR frame, shares of the frame."""
    net = _load_objects()
    if net is None:
        return []
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    scale = NANODET_SIZE / max(h, w)
    nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
    canvas = np.full((NANODET_SIZE, NANODET_SIZE, 3), 114, np.uint8)
    canvas[:nh, :nw] = cv2.resize(bgr, (nw, nh))
    blob = cv2.dnn.blobFromImage(canvas, 1 / 57.375, (NANODET_SIZE, NANODET_SIZE), (103.53, 116.28, 123.675), swapRB=False)
    net.setInput(blob)
    try:
        outs = net.forward(["792", "814", "836", "795", "817", "839"])
    except cv2.error:
        outs = net.forward(net.getUnconnectedOutLayersNames())
        outs = sorted(outs, key=lambda o: (o.shape[2] != 80, -o.shape[1]))
    cls = np.concatenate([o[0] for o in outs[:3]])
    reg = np.concatenate([o[0] for o in outs[3:]])
    centres = _centres()
    if cls.shape[0] != centres.shape[0]:
        return []
    label = cls.argmax(1)
    score = cls.max(1)
    keep = np.flatnonzero(score > PERSON_MIN_SCORE)
    boxes = []
    for i in keep:
        name = COCO[int(label[i])]
        if name != "person" and score[i] < OBJECT_MIN_SCORE:
            continue
        dist = (_softmax(reg[i].reshape(4, NANODET_REG_MAX + 1)) * np.arange(NANODET_REG_MAX + 1)).sum(1) * centres[i, 2]
        cx, cy = centres[i, 0], centres[i, 1]
        x0, y0, x1, y1 = cx - dist[0], cy - dist[1], cx + dist[2], cy + dist[3]
        boxes.append((name, float(score[i]), float(x0 / scale), float(y0 / scale), float((x1 - x0) / scale), float((y1 - y0) / scale)))
    if not boxes:
        return []
    rects = [[b[2], b[3], b[4], b[5]] for b in boxes]
    idx = cv2.dnn.NMSBoxes(rects, [b[1] for b in boxes], PERSON_MIN_SCORE, 0.5)
    out = []
    for i in np.array(idx).ravel():
        name, sc, x, y, bw, bh = boxes[int(i)]
        x0, y0 = max(0.0, x), max(0.0, y)
        x1, y1 = min(float(w), x + bw), min(float(h), y + bh)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        out.append((name, round(sc, 3), round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4)))
    return out


def people(bgr) -> list[tuple[float, float, float, float, float]]:
    """(x, y, w, h, score) of every person in a frame, shares of the frame."""
    return [(x, y, w, h, s) for name, s, x, y, w, h in detect_objects(bgr) if name == "person"]


def detect_text(bgr) -> list[tuple[float, float, float, float]]:
    """(x, y, w, h) of each run of text in a BGR frame, shares of the frame.

    Big display titles ("DAY 1" across the picture) read as text only at a
    smaller scale, so the frame is tried at two sizes and the boxes merged.
    """
    det = _load_text()
    if det is None:
        return []
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    found: list[tuple[float, float, float, float]] = []
    for tw in (TEXT_W, TEXT_W // 2):
        th = max(32, int(tw * h / max(1, w)) // 32 * 32)
        tw = max(32, tw // 32 * 32)
        det.setInputParams(1.0 / 255, (tw, th), (122.67891434, 116.66876762, 104.00698793), False)
        small = cv2.resize(bgr, (tw, th))
        try:
            polys, _ = det.detect(small)
        except cv2.error:
            continue
        for poly in polys or []:
            x, y, bw, bh = cv2.boundingRect(np.array(poly, dtype=np.float32))
            box = (x / tw, y / th, bw / tw, bh / th)
            if bw < 4 or bh < 4:
                continue
            if any(_iou(box, other) > 0.5 for other in found):
                continue
            found.append(tuple(round(v, 4) for v in box))
    return found


def _iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    return inter / max(1e-9, a[2] * a[3] + b[2] * b[3] - inter)
