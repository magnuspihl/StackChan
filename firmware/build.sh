#!/usr/bin/env bash
# Build the StackChan kit firmware.
#
#   ./firmware/build.sh                on-device: the robot calls the speech and
#                                      LLM APIs itself; no server. Set it up with
#                                      the web flasher (or flash.sh + flasher page).
#   ./firmware/build.sh <server-ip>    server: the robot talks to your own voice
#                                      server (see server/).
#
# Clones M5Stack's StackChan firmware at a pinned commit, applies the kit
# patches, and builds it with Espressif's official Docker image. Output lands
# in firmware/out/. Needs Docker; takes ~10 minutes the first time.
set -euo pipefail

SERVER_IP="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
UPSTREAM_REPO="https://github.com/m5stack/StackChan.git"
UPSTREAM_COMMIT="eff0d6b5109663faec8f1d98848b4b0e5246bbfc"
IDF_IMAGE="espressif/idf:v5.5.4"

mkdir -p "$OUT"
if [ -n "$SERVER_IP" ]; then
  echo "Building firmware for server ${SERVER_IP} (StackChan ${UPSTREAM_COMMIT:0:7})"
else
  echo "Building on-device firmware (StackChan ${UPSTREAM_COMMIT:0:7})"
fi

docker run --rm \
  -v "$HERE:/kit" \
  -e SERVER_IP="$SERVER_IP" -e UPSTREAM_REPO="$UPSTREAM_REPO" -e UPSTREAM_COMMIT="$UPSTREAM_COMMIT" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  "$IDF_IMAGE" bash -euo pipefail -c '
    git config --global --add safe.directory "*"
    git clone -q "$UPSTREAM_REPO" /work/StackChan
    cd /work/StackChan
    git checkout -q "$UPSTREAM_COMMIT"
    git apply /kit/stackchan-kit.patch
    cd firmware

    # The StackChan World cloud (47.113.125.164) is pointed at a dead local
    # port either way: its app features are not used.
    if [ -n "$SERVER_IP" ]; then
      # The robot asks this URL for its voice-server address (instead of api.tenclass.net).
      printf "CONFIG_OTA_URL=\"http://%s:8003/xiaozhi/ota/\"\nCONFIG_STACKCHAN_SERVER_URL=\"http://127.0.0.1:9\"\n" \
        "$SERVER_IP" > sdkconfig.defaults.local
    else
      # No server: nothing to ask for updates either. API settings come from the flasher.
      printf "CONFIG_OTA_URL=\"http://127.0.0.1:9/\"\nCONFIG_STACKCHAN_SERVER_URL=\"http://127.0.0.1:9\"\nCONFIG_KIT_LOCAL_AGENT=y\n" \
        > sdkconfig.defaults.local
    fi

    python3 fetch_repos.py
    git -C xiaozhi-esp32 apply /kit/xiaozhi-kit.patch
    idf.py build

    cp build/bootloader/bootloader.bin build/partition_table/partition-table.bin \
       build/ota_data_initial.bin build/stack-chan.bin build/generated_assets.bin /kit/out/
    if [ -n "$SERVER_IP" ]; then echo "server $SERVER_IP"; else echo "on-device"; fi > /kit/out/mode.txt
    chown -R "$HOST_UID:$HOST_GID" /kit/out
  '

echo "Done. Firmware in $OUT. Next: ./firmware/flash.sh"
