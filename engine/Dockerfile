# crayZmundo Engine — one image, runs the API and the worker in a single process.

# A PO token is the proof-of-origin a browser sends with every video request.
# Without one, YouTube answers a cloud machine with "sign in to confirm you're
# not a bot". bgutil mints that token here, on this machine: no account, no
# cookies, nothing of anyone's sign-in involved. It is built with Node, and
# only the built script and the node binary are carried into the final image.
FROM node:22-bookworm-slim AS potoken
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --single-branch --branch 2.0.2 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil
WORKDIR /opt/bgutil/server
RUN npm ci --no-audit --no-fund && npx tsc && npm prune --omit=dev

FROM python:3.12-slim

# ffmpeg does the cutting and rendering; the fonts are what captions are drawn in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates gosu \
      fonts-dejavu-core fontconfig \
 && rm -rf /var/lib/apt/lists/*

# Node and the built token script, carried over from the stage above. Node
# also solves the JavaScript challenge YouTube sets before it serves a video.
COPY --from=potoken /usr/local/bin/node /usr/local/bin/node
COPY --from=potoken /opt/bgutil/server /opt/bgutil/server
ENV BGUTIL_HOME=/opt/bgutil/server \
    NODE_PATH_BIN=/usr/local/bin/node

# Caption faces named by the style presets. Missing ones fall back, so a failed
# download never breaks a build.
RUN mkdir -p /usr/share/fonts/truetype/crayz && cd /usr/share/fonts/truetype/crayz && \
    for f in \
      "Montserrat/Montserrat-ExtraBold.ttf" \
      "Anton/Anton-Regular.ttf" \
      "PlayfairDisplay/PlayfairDisplay%5Bwght%5D.ttf" \
      "PermanentMarker/PermanentMarker-Regular.ttf" \
      "Bangers/Bangers-Regular.ttf" \
      "LuckiestGuy/LuckiestGuy-Regular.ttf" ; do \
      curl -fsSL -O "https://github.com/google/fonts/raw/main/ofl/$(echo $f | tr 'A-Z' 'a-z' | cut -d/ -f1)/$(basename $f)" || true ; \
    done && fc-cache -f

# The face detector OpenCV needs. Without it the Engine falls back to motion
# tracking, which works but is less precise on talking heads.
RUN mkdir -p /models && \
    curl -fsSL -o /models/face_detection_yunet.onnx \
      "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" || \
    echo "note: face model not fetched; motion tracking will be used"
ENV FACE_MODEL_PATH=/models/face_detection_yunet.onnx

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.30" "sqlmodel>=0.0.22" "pydantic-settings>=2.4" \
      "python-multipart>=0.0.9" "httpx>=0.27" \
      "faster-whisper>=1.0" "opencv-python-headless>=4.9" "numpy>=1.26" \
      "yt-dlp>=2026.8.19" "bgutil-ytdlp-pot-provider>=2.0.2" "yt-dlp-ejs>=0.8.0" \
      "boto3>=1.34"

COPY app ./app
RUN useradd -m engine && chown -R engine /app

# A Fly volume mounts as root, so ownership is fixed at boot and the process
# then drops to an unprivileged user. gosu execs, so uvicorn stays PID 1 and
# receives SIGTERM directly — a shell wrapper would swallow it.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV DATA_DIR=/data \
    HF_HOME=/data/models \
    SHUTDOWN_GRACE_S=120
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD curl -fsS http://localhost:8080/v1/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# `python -m app`, not the uvicorn CLI: app/__main__.py owns the Server so the
# idle watchdog can stop it with exit 0. Through the CLI, uvicorn re-raises the
# signal and exits 143, which Fly treats as a crash and restarts.
CMD ["python", "-m", "app"]
