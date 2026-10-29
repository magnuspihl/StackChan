# Your own speech server (optional)

Lets StackChan hear and speak through models on your own machine instead of a
cloud speech service, in **Danish**, **English**, or both. Your voice and the
robot's replies then stay on your network. The AI model itself (OpenAI,
Claude, ...) is still whatever you pick in the flasher.

| | Hearing (speech-to-text) | Voice (text-to-speech) | Download |
|---|---|---|---|
| Danish | [roest-v3-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v3-whisper-1.5b) | [roest-v3-chatterbox-500m](https://huggingface.co/CoRal-project/roest-v3-chatterbox-500m) (`roest-tts/`, port 8881) | ~5 GB |
| English | [faster-distil-whisper-large-v3](https://huggingface.co/Systran/faster-distil-whisper-large-v3) | [Kokoro 82M](https://huggingface.co/speaches-ai/Kokoro-82M-v1.0-ONNX) | ~2 GB |

Speech-to-text (both languages) and the English voice run in
[speaches](https://github.com/speaches-ai/speaches) on port 8000. The Danish
models come from Denmark's [CoRal project](https://huggingface.co/CoRal-project).

## What you need

- A machine that stays on while you use the robot, with an **NVIDIA GPU**:
  about 8 GB free for Danish, 3 GB for English only.
- Docker with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).
- A fixed IP address for that machine (a DHCP reservation on your router).

## Start it

```sh
cd speech
cp .env.example .env
# edit .env: COMPOSE_PROFILES=danish, english, or danish,english
docker compose up -d
docker compose logs -f     # first start: watch the downloads
```

Only the languages you pick are downloaded. For Danish, the first start also
converts the speech-to-text model once (a few minutes). After that, starts are
quick. To add a language later, change `COMPOSE_PROFILES` and run
`docker compose up -d` again.

Check it:

```sh
curl http://localhost:8000/v1/models    # the speech-to-text and voice models
curl http://localhost:8881/voices       # Danish voices ("default" + your own)
```

## Point the robot at it

In the web flasher, step 3: **Speech → "My own speech server (Danish)"** or
**"(English)"**, and enter this machine's IP address. That fills in:

| | Danish | English |
|---|---|---|
| Speech-to-text | `http://<ip>:8000/v1`, `local/roest-v3-whisper-1.5b-ct2`, language `da` | `http://<ip>:8000/v1`, `Systran/faster-distil-whisper-large-v3`, language `en` |
| Voice | `http://<ip>:8881/v1`, model `roest`, voice `default` | `http://<ip>:8000/v1`, `speaches-ai/Kokoro-82M-v1.0-ONNX`, voice `af_heart` |
| The robot answers in | Danish | English |

No API keys are needed. Other English voices: `af_bella`, `af_nicole`,
`am_adam`, `am_michael`, `bf_emma`, `bm_george` and more (listed under the
Kokoro model in `curl "http://localhost:8000/v1/registry?task=text-to-speech"`).
If you change the English models in `.env`, enter the same names in the flasher.

## What to expect

- **The Danish voice is slower than real time** (about 1.5x on an RTX 3080), so
  replies start a few seconds later than with a cloud voice, and there can be
  small gaps between sentences. The text is sent one sentence at a time to keep
  that short. The English voice is much faster.
- **The first Danish reply after the voice model unloads takes about a
  minute.** It unloads after `ROEST_TTS_KEEPALIVE_MINS` (60) idle minutes to
  free the GPU; raise it if the GPU has nothing else to do.
- **The wake word stays English** ("Hi Stack-chan"): it's built into the
  firmware.

## Your own Danish voices

The `default` voice is the speaker that ships with the model. To add more, put
~10 second clean recordings (`.wav`) in `voices/`; each file becomes a voice
named after the file (`voices/anna.wav` → voice `anna`). No restart needed.
Only use recordings of people who agreed to it.

## Security

There is no login on either port. Keep them on your LAN; never forward them to
the internet.
