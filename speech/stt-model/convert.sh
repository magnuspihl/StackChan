#!/usr/bin/env bash
# Converts CoRal-project/roest-v3-whisper-1.5b (Danish Whisper large-v3 fine-tune)
# to CTranslate2 float16 and installs it where speaches looks for local models,
# as the model "local/roest-v3-whisper-1.5b-ct2". Runs once; later starts skip it.
set -euo pipefail

SOURCE_REPO="CoRal-project/roest-v3-whisper-1.5b"
MODEL_DIR="/hub/models--local--roest-v3-whisper-1.5b-ct2"
REVISION="ct2-float16"
SNAPSHOT="$MODEL_DIR/snapshots/$REVISION"

if [ -f "$SNAPSHOT/model.bin" ]; then
  echo "roest-v3 Whisper is already converted."
  exit 0
fi

echo "Installing the converter (CPU-only PyTorch)..."
pip install --no-cache-dir -q torch --index-url https://download.pytorch.org/whl/cpu
pip install --no-cache-dir -q ctranslate2 transformers huggingface_hub

echo "Downloading $SOURCE_REPO and converting it (a few minutes)..."
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('$SOURCE_REPO', local_dir='/tmp/source')"
rm -rf "$SNAPSHOT.tmp"
ct2-transformers-converter --model /tmp/source --output_dir "$SNAPSHOT.tmp" --quantization float16 \
  --copy_files tokenizer.json preprocessor_config.json

# speaches only lists local models whose card says they are CTranslate2 speech recognition.
cat > "$SNAPSHOT.tmp/README.md" <<'EOF'
---
library_name: ctranslate2
pipeline_tag: automatic-speech-recognition
language: da
license: openrail
base_model: CoRal-project/roest-v3-whisper-1.5b
---
roest-v3-whisper-1.5b converted to CTranslate2 (float16) for faster-whisper / speaches.
EOF

mv "$SNAPSHOT.tmp" "$SNAPSHOT"
mkdir -p "$MODEL_DIR/refs"
printf '%s' "$REVISION" > "$MODEL_DIR/refs/main"
chown -R 1000:1000 /hub  # speaches runs as uid 1000
rm -rf /tmp/source
echo "Done: model local/roest-v3-whisper-1.5b-ct2"
