# Privacy audit

How the kit was checked, and what was found. Repeat it on your own network if
you want proof rather than a promise.

## Stock firmware and server: what phones home

From reading M5's firmware source and the upstream server:

| Component | Contacts | When |
|---|---|---|
| Robot (stock firmware) | `api.tenclass.net` (xiaozhi cloud) | Every AI-agent session: it hands out the voice server, so your **microphone audio** went there. Also the firmware update channel. |
| Robot (stock firmware) | `47.113.125.164:12800` (StackChan server, plain HTTP) | App features, avatar relay |
| Robot (stock firmware) | `ezdata2.m5stack.com`, `uiflow2.m5stack.com` | Only when the EzData app is opened |
| Server (upstream defaults) | `whois.pconline.com.cn` | Every connection: your public IP is mapped to a city |
| Server (upstream defaults) | QWeather (shared, hardcoded key) | Every connection: weather for that city |
| Server (upstream defaults) | Chinese LLM / speech / search providers | Default modules (GLM, FunASR, Metaso, ...) |

## Kit: measured

**Server.** A packet capture inside the voice server's network namespace,
during normal use (conversation, photo, sleep). The only outbound
destinations:

- `speech.platform.bing.com` (Edge TTS, Microsoft): by design
- the LLM provider: by design
- local services (Whisper, the robot) and DNS to the router

No pconline, QWeather or Chinese hosts. DNS queries were only for the TTS and
LLM hostnames.

**Robot.** It was blocked from the internet with a router rule (LAN only) and
used normally: chat, photos, sleep and wake all worked, and the router logged
**no blocked attempts**. It doesn't need the internet, and hasn't tried.
(First measured over a test session; a longer idle window is being checked
for anything periodic.)

## Reproduce it

- **Robot:** add the "block internet" router rule (README step 5) and watch
  the router's flow or firewall log for its MAC address.
- **Server:** capture its traffic, e.g.
  `docker run --rm --net container:stackchan-server nicolaka/netshoot tcpdump -n -i any 'not port 8000'`
  and look at the destinations.
