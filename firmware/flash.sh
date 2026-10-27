#!/usr/bin/env bash
# Flash the kit firmware onto a StackChan connected by USB.
#
#   ./firmware/flash.sh [serial-port]      (default: /dev/ttyACM0)
#
# Needs esptool 5+ (pipx install esptool, or: python3 -m pip install esptool).
# The FIRST run saves a full 16 MB backup of the robot's factory firmware to
# firmware/out/factory-backup-*.bin. Keep that file: it is the only way back
# to stock (see README, "Going back to the factory firmware").
#
# The NVS partition (0x9000) is deliberately NOT written, so the robot keeps
# the Wi-Fi network it was set up with.
set -euo pipefail

PORT="${1:-/dev/ttyACM0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"

if command -v esptool >/dev/null 2>&1; then
  ESPTOOL=(esptool)
else
  ESPTOOL=(python3 -m esptool)
fi
ESP=("${ESPTOOL[@]}" --chip esp32s3 --port "$PORT")

for f in bootloader.bin partition-table.bin ota_data_initial.bin stack-chan.bin generated_assets.bin; do
  [[ -f "$OUT/$f" ]] || { echo "Missing $OUT/$f. Run ./firmware/build.sh <server-ip> first." >&2; exit 1; }
done
[[ -e "$PORT" ]] || { echo "No device at $PORT. Plug the robot in (USB-C) or pass the port." >&2; exit 1; }

if ! compgen -G "$OUT/factory-backup-*.bin" >/dev/null; then
  BACKUP="$OUT/factory-backup-$(date +%Y%m%d-%H%M%S).bin"
  echo "Backing up the factory firmware to $BACKUP (about 1-2 minutes)..."
  "${ESP[@]}" -b 921600 read-flash 0 0x1000000 "$BACKUP"
  "${ESP[@]}" -b 921600 verify-flash 0 "$BACKUP"
  echo "Backup verified."
else
  echo "Factory backup already present in $OUT, skipping."
fi

echo "Flashing kit firmware (server: $(cat "$OUT/server-ip.txt" 2>/dev/null || echo unknown))..."
"${ESP[@]}" -b 921600 write-flash --flash_mode dio --flash_freq 80m --flash_size 16MB \
  0x0      "$OUT/bootloader.bin" \
  0x8000   "$OUT/partition-table.bin" \
  0xd000   "$OUT/ota_data_initial.bin" \
  0x20000  "$OUT/stack-chan.bin" \
  0xa00000 "$OUT/generated_assets.bin"

echo "Done. The robot restarts by itself. Open the AI Agent app on it and say \"Hi Stack-chan\"."
