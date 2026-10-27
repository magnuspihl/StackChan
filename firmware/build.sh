#!/usr/bin/env bash
# Build the StackChan kit firmware for YOUR voice server.
#
#   ./firmware/build.sh <server-LAN-IP>
#
# Clones M5Stack's StackChan firmware at a pinned commit, applies the kit patch
# (sleep mode, extra faces), points the robot at your server instead of the
# xiaozhi / StackChan clouds, and builds it with Espressif's official Docker
# image. Output lands in firmware/out/. Needs Docker; takes ~10 minutes the
# first time.
set -euo pipefail

SERVER_IP="${1:?usage: $0 <server LAN IP, e.g. 192.168.1.50>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
UPSTREAM_REPO="https://github.com/m5stack/StackChan.git"
UPSTREAM_COMMIT="eff0d6b5109663faec8f1d98848b4b0e5246bbfc"
IDF_IMAGE="espressif/idf:v5.5.4"

mkdir -p "$OUT"
echo "Building firmware for server ${SERVER_IP} (StackChan ${UPSTREAM_COMMIT:0:7})"

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

    # The robot asks this URL for its voice-server address (instead of
    # api.tenclass.net). The StackChan World cloud (47.113.125.164) is
    # pointed at a dead local port: its app features are not used.
    printf "CONFIG_OTA_URL=\"http://%s:8003/xiaozhi/ota/\"\nCONFIG_STACKCHAN_SERVER_URL=\"http://127.0.0.1:9\"\n" \
      "$SERVER_IP" > sdkconfig.defaults.local

    python3 fetch_repos.py
    idf.py build

    cp build/bootloader/bootloader.bin build/partition_table/partition-table.bin \
       build/ota_data_initial.bin build/stack-chan.bin build/generated_assets.bin /kit/out/
    echo "$SERVER_IP" > /kit/out/server-ip.txt
    chown -R "$HOST_UID:$HOST_GID" /kit/out
  '

echo "Done. Firmware in $OUT. Next: ./firmware/flash.sh"
