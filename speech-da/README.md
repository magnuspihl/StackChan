# Danish speech server (optional)

Lets StackChan hear and speak Danish with models from Denmark's
[CoRal project](https://huggingface.co/CoRal-project), running on your own
machine instead of a cloud speech service:

| | Model | Port |
|---|---|---|
| Hearing (speech-to-text) | [roest-v3-whisper-1.5b](https://huggingface.co/CoRal-project/roest-v3-whisper-1.5b) in [speaches](https://github.com/speaches-ai/speaches) | 8000 |
| Voice (text-to-speech) | [roest-v3-chatterbox-500m](https://huggingface.co/CoRal-project/roest-v3-chatterbox-500m) in `roest-tts/` | 8881 |

Your voice and the robot's replies then stay on your network. The AI model itself
(OpenAI, Claude, ...) is still whatever you pick in the flasher.

## What you need

- A machine that stays on while you use the robot, with an **NVIDIA GPU with
  about 8 GB of free memory** (the voice model is too slow without one).
- Docker with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).
- A fixed IP address for that machine (a DHCP reservation on your router).

## Start it

```sh
cd speech-da
docker compose up -d
docker compose logs -f stt-model   # first start only: watch the one-off conversion
```

The first start downloads about 10 GB and converts the speech-to-text model
once (a few minutes). After that, starts are quick.

Check it:

```sh
curl http://localhost:8000/v1/models    # lists local/roest-v3-whisper-1.5b-ct2
curl http://localhost:8881/voices       # lists "default" (+ your own voices)
```

## Point the robot at it

In the web flasher, step 3: **Speech → "My own Danish speech server"**, and enter
this machine's IP address. That fills in:

| Setting | Value |
|---|---|
| Speech-to-text | `http://<ip>:8000/v1`, model `local/roest-v3-whisper-1.5b-ct2`, language `da` |
| Voice | `http://<ip>:8881/v1`, model `roest`, voice `default` |
| The robot answers in | `Danish` |

No API keys are needed for these two.

## What to expect

- **The voice is slower than real time** (about 1.5x on an RTX 3080), so replies
  start a few seconds later than with a cloud voice, and there can be small gaps
  between sentences. The text is sent one sentence at a time to keep that short.
- **The first reply after the voice model unloads takes about a minute.** It
  unloads after `ROEST_TTS_KEEPALIVE_MINS` (60) idle minutes to free the GPU;
  raise it if the GPU has nothing else to do.
- **The wake word stays English** ("Hi Stack-chan"): it's built into the
  firmware. Everything after it is Danish.

## Your own voices

The `default` voice is the speaker that ships with the model. To add more, put
~10 second clean recordings (`.wav`) in `voices/`; each file becomes a voice
named after the file (`voices/anna.wav` → voice `anna`). No restart needed.
Only use recordings of people who agreed to it.

## Security

There is no login on either port. Keep them on your LAN; never forward them to
the internet.
