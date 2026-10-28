# StackChan, without the Chinese cloud

A setup for the **M5Stack StackChan (K151)** desk robot that keeps it off the
Chinese cloud services it ships with, and gives it a brain you choose (Claude,
OpenAI, or anything OpenAI-compatible).

Out of the box, StackChan's AI agent streams your microphone to the xiaozhi
cloud (`api.tenclass.net`) and talks to M5's StackChan server over plain HTTP
(`47.113.125.164`). That cloud also controls the robot's firmware updates.
The kit replaces all of that, and adds things the stock firmware lacks.

**What you get, either way**

- **Pick the AI**: OpenAI, Claude, or anything OpenAI-compatible.
- **A real body.** The model moves the head, sets the lights (colours and
  effects like breathing or a rainbow), takes and looks at photos, and goes to
  sleep.
- **A proper sleep mode.** "Go to sleep" gives closed eyes, a Zzz bubble and
  dark lights; head and motors stay still until you wake it.
- **More faces:** surprised, thinking, loving (with a heart), embarrassed
  (blush), plus happy, sad, angry and doubtful. The model picks one per reply.
- **No M5 or xiaozhi cloud**, and no firmware updates from anyone but you.

## Two ways to run it

| | **On-device** (recommended) | **With your own voice server** |
|---|---|---|
| What runs where | The robot calls the speech and AI services itself | A server on your network does speech and AI; the robot only talks to it |
| You need | The robot, Wi-Fi, an API key, Chrome or Edge | Also an always-on machine with Docker |
| Setup | Everything in a web page, over USB | Build and flash firmware, edit a config file |
| Your voice goes to | The speech service you pick (or your own, see [Danish speech](speech-da/)) | Your server (local Whisper) |

## On-device setup

1. Plug the robot into your computer with a USB-C cable and open the
   **[web flasher](https://magnuspihl.github.io/StackChan/)** in Chrome or Edge.
2. **Connect**, then **Install firmware**. The first time, keep "save a backup"
   ticked: that file is your way back to the factory firmware (the same page can
   restore it).
3. **Settings**: your Wi-Fi, the AI and speech providers and your API key(s),
   the language it answers in, and optionally its personality. Save; the robot
   restarts.
4. Say **"Hi Stack-chan"** (or tap the screen) and talk.

No StackChan World app needed: Wi-Fi is set from the page. You can come back
any time to change settings; your keys never leave the USB cable.

Things to know:

- **Your API keys are stored on the robot, unencrypted.** Anyone holding it can
  read them out. Use keys with a spending limit.
- **What you say goes to the providers you pick**: your voice to speech-to-text,
  the conversation and any photos you ask for to the AI, its replies to the
  voice service.
- The voice service must return raw 24 kHz audio (`response_format: "pcm"`),
  as OpenAI does. For **Danish** with your own GPU, see [speech-da/](speech-da/).
- To build the firmware yourself: `./firmware/build.sh` (Docker, ~10 minutes),
  then flash with `./firmware/flash.sh` or point the web flasher at it
  (`web/flasher/`, served from `localhost`).

The rest of this README describes the server setup.

## Server setup: how it fits together

```
 StackChan (robot)  ──Wi-Fi, LAN only──▶  your server (Docker)
   mic, speaker,                            ├─ voice server (xiaozhi-esp32-server,
   head, camera,                            │   patched: English, no cloud defaults)
   face                                     ├─ Whisper speech-to-text (local)
                                            ├─▶ LLM API (Anthropic / OpenAI / ...)
                                            └─▶ Microsoft Edge TTS (the voice)
```

The robot only ever talks to your server. You can (and should) block it from
the internet entirely on your router; it works fine that way. Web search is
optional, done by the server, never by the robot.

## What you need

- The StackChan, with its Wi-Fi already set up (see step 1).
- An always-on-ish machine with Docker on the same network. Your desktop is
  fine; the robot only works while the server runs.
- An API key for the model (Anthropic or OpenAI). Note: a Claude or ChatGPT
  *subscription* doesn't work here; it has to be an API key (pay per use, a
  few kroner a month at desk-toy volumes).
- A USB-C cable, and Python with `esptool` for flashing (`pipx install esptool`).

## Setup

### 1. Connect the robot to Wi-Fi (once, with the stock firmware)

Set up Wi-Fi using M5's **StackChan World** app, the normal way. The kit
firmware keeps the Wi-Fi settings already stored on the robot. (The web
flasher's Wi-Fi step only works with the on-device firmware.)

### 2. Start the server

Give the server machine a fixed IP (a DHCP reservation on your router), then:

```sh
cd server
mkdir -p data
cp config/config.example.yaml data/.config.yaml
cp config/kit-prompt.txt data/
# edit data/.config.yaml: the three "CHANGE ME" spots (server IP, API key x2)
docker compose up -d --build
docker compose logs -f xiaozhi     # optional: watch it start
```

The first start downloads the Whisper model (a few hundred MB).

### 3. Build and flash the firmware

```sh
./firmware/build.sh 192.168.1.50      # your server's IP
# plug the robot in with USB-C
./firmware/flash.sh                   # or: ./firmware/flash.sh /dev/ttyACM1
```

The first flash saves a **full backup of the factory firmware** to
`firmware/out/factory-backup-*.bin`. Keep that file somewhere safe.

### 4. Talk to it

On the robot, open the **AI Agent** app and say **"Hi Stack-chan"** (or tap
it). Things to try: *"Look up at the ceiling and turn your light blue."*,
*"What do you see?"*, *"Look at me."*, *"You can go to sleep."*

### 5. Recommended: block the robot from the internet

On your router, add a rule that blocks the robot's MAC address from the
internet (LAN traffic still allowed). On UniFi: Settings → Security → Traffic
Rules → Block → Internet → target the robot. This turns "trust me" into
"enforced", and any attempt shows up in your router logs. The only thing it
tries is NTP time sync (`pool.ntp.org`, UDP 123, every few minutes), which is
harmless and carries no data. Allow UDP 123 in the rule if you want its clock
synced; it works fine without.

## Settings

Everything lives in `server/data/.config.yaml` and `server/data/kit-prompt.txt`.
Restart after changes: `docker compose restart xiaozhi`.

| What | Where |
|---|---|
| Model / provider | `LLM.MainLLM` and `VLLM.VisionLLM`: `base_url`, `model_name`, `api_key`. Any OpenAI-compatible API. The vision block uses `url:`, not `base_url:`. |
| Personality | `prompt:` (who it is) |
| Behaviour rules | `kit-prompt.txt` (reply length, tool use, faces, head angles) |
| Voice | `TTS.EdgeVoice.voice` (e.g. `en-GB-SoniaNeural`, `en-US-GuyNeural`) |
| Instant exit phrases | `exit_commands` (whole-sentence match; case and punctuation ignored) |
| Web search | `plugins.web_search` + add `web_search` to `Intent.function_call.functions` (needs a free Tavily key) |
| Language | Set `language` in ASR (`en`), VLLM and TTS (`English`) together, and pick a matching voice. **All three must be set**: the upstream server defaults to Chinese. |

The wake word ("Hi Stack-chan") is built into the firmware model and can't be
changed from the config.

## Privacy: what goes where

| Data | Goes to |
|---|---|
| Your voice (audio) | Stays on your server (local Whisper) |
| What you said (text) + conversation | Your LLM provider |
| Camera photos (only when asked) | Your LLM provider |
| The robot's replies (text) | Microsoft (Edge TTS), to be spoken |
| Web searches (if enabled) | Tavily |
| Anything to China / M5 / xiaozhi | Nothing; see [docs/privacy-audit.md](docs/privacy-audit.md) |

Caveats:

- The server has **no authentication**. Keep ports 8000/8003 on your LAN; never
  forward them to the internet.
- Your API key lives in `server/data/.config.yaml`, in plain text. It is
  git-ignored.
- The **StackChan World app's features** (remote avatar control, dances, video)
  don't work with this firmware: they need M5's cloud server.
- The kit firmware removes the built-in **EzData** app, which talks to M5's cloud.

## Going back to the factory firmware

With the [web flasher](https://magnuspihl.github.io/StackChan/): "Restore a backup", and pick the backup file. Or with esptool:

```sh
esptool --chip esp32s3 --port /dev/ttyACM0 write-flash 0 firmware/out/factory-backup-<date>.bin
```

(M5Burner can also restore the official firmware.)

## What the kit changes, and why

**Firmware** (`firmware/stackchan-kit.patch`, on top of M5's StackChan
`eff0d6b`):

- **Sleep mode:** after "go to sleep" it stays asleep. Upstream restarted the
  idle head movement and reset the face a moment later. Only a new session
  (wake word or tap) wakes it.
- **Faces:** a sleep face with level, closed eyes (the original looked sad), a
  "Zzz..." bubble that stays, and new expressions: surprised, thinking,
  loving, embarrassed. Upstream showed a blank face for most emotions.
- **Server address:** set at build time (`build.sh`).

**Server** (`server/Dockerfile`, on top of `xiaozhi-esp32-server` pinned by
digest). Upstream is built for Chinese users and phones home by default. The
kit:

- Replaces the default prompt template. Upstream's looks up your city from your
  public IP via a Chinese service and fetches weather from QWeather on every
  connection. It also contains PRC political rules.
- Forces English everywhere. Upstream injects Chinese example dialogues into
  every session, appends "reply in Chinese" to every camera question, and has
  Chinese tool descriptions and fallback messages.
- Pins web search to Tavily (upstream: Metaso, a Chinese engine).
- Passes a language hint to Whisper, so short English sentences aren't
  misheard as Welsh (really).
- Fixes exit phrases, which upstream compared case- and space-sensitively, so
  they never matched.
- Makes the sleep tool trigger the robot's sleep face.

Every server patch is an exact-string replacement that **fails the build** if
upstream changes, so nothing silently reverts.

## Known limitations

- **Anthropic via the OpenAI-compatible endpoint is the default but hasn't been
  tested with a real key yet.** The kit was developed against a Claude backend
  that speaks the same protocol. If it misbehaves, try OpenAI or report it.
- If the server's IP changes, rebuild and reflash the firmware.
- Each tool action (head, light, photo) takes a few seconds: speech-to-text,
  the model, then speech.
- Server setup: Wi-Fi still needs the official app once (step 1).

## Credits

Built on [M5Stack StackChan](https://github.com/m5stack/StackChan) (MIT),
[xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) (MIT),
[xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) and
[speaches](https://github.com/speaches-ai/speaches). The files in
`server/overrides/` are modified copies of upstream server files.
