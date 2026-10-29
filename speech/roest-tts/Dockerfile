FROM python:3.11-slim

WORKDIR /app

# libsndfile for soundfile, ffmpeg for librosa, git for chatterbox's resemble-perth dependency
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ffmpeg git && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "chatterbox-tts==0.1.7" \
    soundfile \
    fastapi \
    "uvicorn[standard]" \
    pydantic

# chatterbox 0.1.7 forces EOS when just 2 consecutive speech tokens match (its comment says 3x),
# randomly truncating output to a fraction of a second. Upstream: resemble-ai/chatterbox#549.
# The grep fails the build if the line changes, so a version bump can't silently drop the fix.
RUN f=/usr/local/lib/python3.11/site-packages/chatterbox/models/t3/inference/alignment_stream_analyzer.py && \
    grep -q 'len(set(self.generated_tokens\[-2:\])) == 1' "$f" && \
    sed -i 's/len(set(self.generated_tokens\[-2:\])) == 1/len(set(self.generated_tokens[-3:])) == 1/' "$f"

COPY app.py .

ENV ROEST_TTS_MODEL=CoRal-project/roest-v3-chatterbox-500m
ENV ROEST_TTS_DEFAULT_VOICE=default
ENV ROEST_TTS_KEEPALIVE_MINS=10
ENV ROEST_TTS_VOICES_DIR=/voices

EXPOSE 8881

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8881", "--timeout-keep-alive", "75"]
