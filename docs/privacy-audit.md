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
used normally: chat, photos, sleep and wake all worked, so it doesn't need the
internet. Over about 3 hours the router logged 26 blocked attempts, **all NTP
time sync** (UDP 123 to `pool.ntp.org`, `time.cloudflare.com` and
`2.android.pool.ntp.org`, roughly every 165 seconds). These are clock requests
with no data in them, from the firmware's SNTP client (`hal_network.cpp`).
Nothing else was attempted: no xiaozhi, M5 or Chinese hosts.

## Reproduce it

- **Robot:** add the "block internet" router rule (README step 5) and watch
  the router's flow or firewall log for its MAC address.
- **Server:** capture its traffic, e.g.
  `docker run --rm --net container:stackchan-server nicolaka/netshoot tcpdump -n -i any 'not port 8000'`
  and look at the destinations.
