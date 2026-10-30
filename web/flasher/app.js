// StackChan kit flasher: installs the firmware with esptool-js, then writes the
// settings over the same USB cable with the firmware's "KIT ..." line protocol
// (firmware/main/hal/kit_serial_config.cpp). No network requests except for the
// firmware files next to this page.
import { ESPLoader, Transport } from "./esptool-js-0.7.0.js";

const ESPRESSIF_VID = 0x303a;
const FLASH_SIZE = 16 * 1024 * 1024; // StackChan (CoreS3): 16 MB

const AI_PRESETS = {
  openai: { llm_url: "https://api.openai.com/v1", llm_model: "gpt-4.1-mini" },
  anthropic: { llm_url: "https://api.anthropic.com/v1", llm_model: "claude-haiku-5-5" },
  custom: null, // keep whatever is in the fields
};
const SPEECH_PRESETS = {
  openai: () => ({
    stt_url: "https://api.openai.com/v1", stt_model: "gpt-4o-mini-transcribe", stt_lang: "en",
    tts_url: "https://api.openai.com/v1", tts_model: "gpt-4o-mini-tts", tts_voice: "coral", reply_lang: "English",
  }),
  // speech/docker-compose.yml: speaches on :8000 (both languages' hearing, the English voice),
  // roest-tts (the Danish voice) on :8881.
  danish: (server) => ({
    stt_url: `http://${server}:8000/v1`, stt_model: "local/roest-v3-whisper-1.5b-ct2", stt_lang: "da",
    tts_url: `http://${server}:8881/v1`, tts_model: "roest", tts_voice: "default", reply_lang: "Danish",
  }),
  english: (server) => ({
    stt_url: `http://${server}:8000/v1`, stt_model: "Systran/faster-distil-whisper-large-v3", stt_lang: "en",
    tts_url: `http://${server}:8000/v1`, tts_model: "speaches-ai/Kokoro-82M-v1.0-ONNX", tts_voice: "af_heart",
    reply_lang: "English",
  }),
  custom: null,
};
const PLAIN_KEYS = ["llm_url", "llm_model", "stt_url", "stt_model", "stt_lang", "tts_url", "tts_model", "tts_voice", "reply_lang",
  "sleep_min"];
const SECRET_KEYS = ["llm_key", "stt_key", "tts_key"];

const $ = (id) => document.getElementById(id);
let busy = false;
let resetPersona = false; // "go back to the default personality" was clicked

// ---------- log and status ----------

function log(text) {
  const el = $("log");
  el.textContent += text.endsWith("\n") ? text : text + "\n";
  el.scrollTop = el.scrollHeight;
}

function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status " + kind;
}

async function run(statusId, task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await task();
  } catch (err) {
    console.error(err);
    log("Error: " + (err && err.message ? err.message : err));
    setStatus(statusId, err && err.message ? err.message : String(err), "bad");
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

// ---------- the robot's settings protocol ----------

class RobotLink {
  constructor(serialPort) {
    this.port = serialPort;
    this.buffer = "";
    this.waiters = new Map(); // command id -> resolve
    this.nextId = 1;
  }

  async open() {
    await this.port.open({ baudRate: 115200 });
    // Release the control lines without restarting the robot: on the ESP32-S3's
    // USB port, RTS on with DTR off means "reset", so RTS goes off first.
    await this.port.setSignals({ requestToSend: false }).catch(() => {});
    await this.port.setSignals({ dataTerminalReady: false }).catch(() => {});
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.pump = this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl).replace(/\r$/, "");
          this.buffer = this.buffer.slice(nl + 1);
          const at = line.indexOf("KIT-REPLY ");
          if (at < 0) continue;
          let reply;
          try { reply = JSON.parse(line.slice(at + 10)); } catch (_) { continue; }
          // Only the command it belongs to; late answers to earlier ones are dropped.
          const resolve = this.waiters.get(reply.id);
          if (resolve) {
            this.waiters.delete(reply.id);
            resolve(reply);
          }
        }
      }
    } catch (_) {
      // port closed or device gone
    }
  }

  // One command, one reply. Rejects on timeout.
  async send(command, timeoutMs = 4000) {
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error("The robot did not answer"));
      }, timeoutMs);
      this.waiters.set(id, (parsed) => { clearTimeout(timer); resolve(parsed); });
    });
    await this.writer.write(new TextEncoder().encode("KIT " + JSON.stringify({ ...command, id }) + "\n"));
    const parsed = await reply;
    if (!parsed.ok) throw new Error("The robot said: " + parsed.error);
    return parsed;
  }

  // After a restart the firmware needs a few seconds before it listens.
  async waitUntilReady(totalMs = 30000) {
    const end = Date.now() + totalMs;
    for (;;) {
      try {
        return await this.send({ cmd: "info" }, 1500);
      } catch (err) {
        if (Date.now() > end) throw new Error("No answer from the robot. Is the kit firmware installed (step 2)?");
      }
    }
  }

  async close() {
    try { await this.reader.cancel(); } catch (_) {}
    try { this.reader.releaseLock(); } catch (_) {}
    try { this.writer.releaseLock(); } catch (_) {}
    await this.pump?.catch(() => {});
    try { await this.port.close(); } catch (_) {}
  }
}

// The robot re-appears as a new USB device after a restart; find it again.
async function robotPort() {
  const ports = await navigator.serial.getPorts();
  const found = ports.find((p) => p.getInfo().usbVendorId === ESPRESSIF_VID);
  if (found) return found;
  throw new Error("Robot not found. Click \"Connect to the robot\" again.");
}

async function withRobot(task) {
  const link = new RobotLink(await robotPort());
  await link.open();
  try {
    return await task(link);
  } finally {
    await link.close();
  }
}

// ---------- step 1: connect ----------

async function connect() {
  // Grants this page access; later steps find the port again with getPorts().
  await navigator.serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_VID }] });
  setStatus("connect-status", "Connected.", "ok");
  log("Robot selected.");
  $("step-flash").classList.remove("disabled");
  $("step-restore").classList.remove("disabled");
  $("step-settings").classList.remove("disabled");
}

// ---------- step 2: back up and install ----------

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function loadFirmware() {
  const manifest = await (await fetch("firmware/manifest.json", { cache: "no-cache" })).json();
  const files = [];
  for (const part of manifest.files) {
    const response = await fetch("firmware/" + part.file, { cache: "no-cache" });
    if (!response.ok) throw new Error("Missing firmware file " + part.file);
    files.push({ address: part.address, data: new Uint8Array(await response.arrayBuffer()), name: part.file });
  }
  return { manifest, files };
}

// Connects esptool to the robot (bootloader mode), checks it is an ESP32-S3,
// runs task(loader), and always lets go of the port afterwards.
async function withLoader(statusId, task) {
  const transport = new Transport(await robotPort(), false);
  const terminal = { clean() {}, writeLine: (t) => log(t), write: (t) => log(t) };
  const loader = new ESPLoader({ transport, baudrate: 921600, terminal });
  try {
    setStatus(statusId, "Connecting…");
    const chip = await loader.main();
    if (!/ESP32-S3/i.test(chip)) throw new Error(`This is a ${chip}, not a StackChan (ESP32-S3). Stopped.`);
    await task(loader);
    await loader.after("hard_reset");
  } finally {
    await transport.disconnect().catch(() => {});
  }
}

async function write(loader, files, progress) {
  const total = files.reduce((n, f) => n + f.data.length, 0);
  const before = files.map((_, i) => files.slice(0, i).reduce((n, f) => n + f.data.length, 0));
  await loader.writeFlash({
    fileArray: files.map((f) => ({ data: f.data, address: f.address })),
    flashMode: "keep",
    flashFreq: "keep",
    flashSize: "keep",
    eraseAll: false,
    compress: true,
    reportProgress: (index, written) => {
      progress.value = (100 * (before[index] + written)) / total;
    },
  });
  progress.value = 100;
}

async function flash() {
  const progress = $("flash-progress");
  progress.hidden = false;
  progress.value = 0;

  setStatus("flash-status", "Downloading the firmware…");
  const { manifest, files } = await loadFirmware();
  log(`Firmware ${manifest.version}: ${files.map((f) => f.name).join(", ")}`);

  await withLoader("flash-status", async (loader) => {
    if ($("backup").checked) {
      setStatus("flash-status", "Saving a backup of the current firmware…");
      const backup = await loader.readFlash(0, FLASH_SIZE, (_packet, done, total) => {
        progress.value = (100 * done) / total;
      });
      const date = new Date().toISOString().slice(0, 10);
      download(backup, `stackchan-backup-${date}.bin`);
      log(`Backup saved (${backup.length} bytes). Keep this file: it restores the factory firmware.`);
      $("backup").checked = false;
    }
    setStatus("flash-status", "Installing…");
    // Only the firmware parts: the robot's settings and Wi-Fi stay.
    await write(loader, files, progress);
  });
  setStatus("flash-status", "Installed. The robot is restarting; continue with the settings.", "ok");
  log("Firmware installed.");
}

// ---------- restore a backup ----------

// A backup made here (or with esptool read-flash) is the whole 16 MB flash chip.
function checkBackup(bytes) {
  if (bytes.length !== FLASH_SIZE) {
    return `This file is ${(bytes.length / 1048576).toFixed(1)} MB; a full StackChan backup is exactly 16 MB.`;
  }
  if (bytes[0] !== 0xe9) return "This file doesn't start with an ESP32 bootloader; it isn't a full backup.";
  if (bytes[0x8000] !== 0xaa || bytes[0x8001] !== 0x50) return "This file has no partition table where one belongs.";
  return null;
}

async function restore() {
  const file = $("restore-file").files[0];
  if (!file) throw new Error("Choose a backup file first.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkBackup(bytes);
  if (problem) throw new Error(problem);
  if (!confirm(`Write "${file.name}" back to the robot?\n\nThis replaces everything on it, including the kit ` +
               "firmware, its settings and Wi-Fi, with exactly what the backup holds.")) {
    setStatus("restore-status", "Cancelled.");
    return;
  }
  const progress = $("restore-progress");
  progress.hidden = false;
  progress.value = 0;
  await withLoader("restore-status", async (loader) => {
    setStatus("restore-status", "Restoring… (a few minutes)");
    await write(loader, [{ data: bytes, address: 0 }], progress);
  });
  setStatus("restore-status", "Restored. The robot is restarting with the backed-up firmware.", "ok");
  log(`Restored ${file.name}.`);
}

// ---------- step 3: settings ----------

function applyAiPreset() {
  const ai = AI_PRESETS[$("ai-preset").value];
  if (ai) for (const [key, value] of Object.entries(ai)) $(key).value = value;
  updateSameKey();
}

function applySpeechPreset() {
  const speech = $("speech-preset").value;
  $("speech-server-row").hidden = speech !== "danish" && speech !== "english";
  const server = $("speech-server").value.trim() || "SERVER-IP";
  const values = SPEECH_PRESETS[speech]?.(server);
  if (values) for (const [key, value] of Object.entries(values)) $(key).value = value;
  forgetVoices();
  updateSameKey();
}

// One key only makes sense when OpenAI does both; your own speech server needs none.
function updateSameKey() {
  $("same-key").checked = $("ai-preset").value === "openai" && $("speech-preset").value === "openai";
  syncKeyFields();
}

function syncKeyFields() {
  const same = $("same-key").checked;
  for (const key of ["stt_key", "tts_key"]) {
    $(key).disabled = same;
    $(key).placeholder = same ? "same as the AI model key" : "";
  }
}

function showCurrent(info) {
  const s = info.settings;
  const keys = SECRET_KEYS.map((k) => `${k.split("_")[0].toUpperCase()} key ${s[k] ? "set" : "not set"}`).join(", ");
  const wifi = info.wifi.length ? info.wifi.join(", ") : "none";
  $("current").textContent = `Firmware ${info.firmware}. Wi-Fi networks: ${wifi}. ${keys}.`;
  if (s.persona) $("persona").value = s.persona;
  $("boot_ai").checked = !!info.boot_ai;
  // Show stored values; empty means the firmware's default is in use.
  for (const key of PLAIN_KEYS) if (s[key]) $(key).value = s[key];
  forgetVoices();
  log("Read the robot's settings.");
}

async function readSettings() {
  setStatus("save-status", "");
  const info = await withRobot((link) => link.waitUntilReady(8000));
  showCurrent(info);
}

// The form's values as the robot stores them (empty fields left out).
function formValues() {
  const values = {};
  for (const key of PLAIN_KEYS) {
    const v = $(key).value.trim();
    if (v) values[key] = v;
  }
  for (const key of SECRET_KEYS) {
    const v = $(key).value.trim();
    if (v) values[key] = v;
  }
  if ($("same-key").checked && values.llm_key) {
    values.stt_key = values.llm_key;
    values.tts_key = values.llm_key;
  }
  return values;
}

// ---------- tests (run by the robot: the page can't reach http LAN servers) ----------

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

// A speech server that has just started (or unloaded its models) can take minutes to answer the first time.
const SLOW_START = " A speech server that is just starting can take a few minutes.";

async function robotTest(command, resultId, hint = "") {
  setStatus(resultId, `Testing on the robot…${hint}`);
  return withRobot(async (link) => {
    await link.waitUntilReady(8000);
    return link.send({ cmd: command, values: formValues() }, 150000);
  });
}

async function testLlm() {
  const r = await robotTest("test_llm", "test-llm-result");
  setStatus("test-llm-result", `OK in ${(r.ms / 1000).toFixed(1)} s: “${r.text}”`, "ok");
}

async function testStt() {
  const r = await robotTest("test_stt", "test-stt-result", SLOW_START);
  const kind = r.heard.trim() ? "ok" : "bad";
  setStatus("test-stt-result", `Said “${r.said}”, heard “${r.heard}” (${(r.ms / 1000).toFixed(1)} s)`, kind);
}

async function testTts() {
  const r = await robotTest("test_tts", "test-tts-result", SLOW_START);
  const where = r.played ? "The robot just said it." : "Open talk mode on the robot to hear it.";
  setStatus("test-tts-result",
    `OK: ${r.seconds.toFixed(1)} s of speech, first sound after ${(r.first_ms / 1000).toFixed(1)} s. ${where}`, "ok");
}

// Once the server has listed its voices, the Voice field becomes a dropdown of them; the text field
// (which save and the tests read) follows it. Changing the voice server turns it back into a text field.
function showVoices(voices) {
  const pick = $("tts_voice_pick");
  pick.replaceChildren(...voices.map((v) => Object.assign(document.createElement("option"), { value: v, textContent: v })));
  if (voices.includes($("tts_voice").value.trim())) pick.value = $("tts_voice").value.trim();
  $("tts_voice").value = pick.value;
  pick.hidden = false;
  $("tts_voice").hidden = true;
  setStatus("test-tts-result", `${voices.length} voices: pick one in the Voice field.`, "ok");
}

function forgetVoices() {
  $("tts_voice_pick").hidden = true;
  $("tts_voice_pick").replaceChildren();
  $("tts_voice").hidden = false;
}

async function listVoices() {
  if (/api\.openai\.com/.test($("tts_url").value)) {
    showVoices(OPENAI_VOICES);
    return;
  }
  const r = await robotTest("voices", "test-tts-result", SLOW_START);
  showVoices(r.voices);
}

async function save() {
  const values = formValues();
  if (["danish", "english"].includes($("speech-preset").value)) {
    // The local speech server needs no key: erase old ones so they aren't sent to it.
    values.stt_key = "";
    values.tts_key = "";
  }
  if (Object.values(values).some((v) => v.includes("SERVER-IP"))) {
    throw new Error("Enter the speech server's address first.");
  }
  const persona = $("persona").value.trim();
  if (persona) values.persona = persona;
  else if (resetPersona) values.persona = "";
  const ssid = $("ssid").value.trim();
  const password = $("wifi-pass").value;

  setStatus("save-status", "Waiting for the robot…");
  await withRobot(async (link) => {
    await link.waitUntilReady();
    if (ssid) {
      await link.send({ cmd: "wifi", ssid, password });
      log(`Wi-Fi network "${ssid}" saved.`);
    }
    const reply = await link.send({ cmd: "set", values });
    log(`${reply.changed} setting(s) saved.`);
    await link.send({ cmd: "boot_ai", on: $("boot_ai").checked });
    await link.send({ cmd: "reboot" });
  });
  for (const key of SECRET_KEYS) $(key).value = "";
  $("wifi-pass").value = "";
  resetPersona = false;
  setStatus("save-status", "Saved. The robot restarts with the new settings; open the AI Agent app to try it.", "ok");
}

// ---------- wiring ----------

if (!("serial" in navigator)) {
  $("no-serial").hidden = false;
  $("connect").disabled = true;
} else {
  navigator.serial.addEventListener("disconnect", () => log("(robot disconnected)"));
  navigator.serial.addEventListener("connect", () => log("(robot connected)"));
}
$("connect").addEventListener("click", () => run("connect-status", connect));
$("flash").addEventListener("click", () => run("flash-status", flash));
$("restore").addEventListener("click", () => run("restore-status", restore));
$("test-llm").addEventListener("click", () => run("test-llm-result", testLlm));
$("test-stt").addEventListener("click", () => run("test-stt-result", testStt));
$("test-tts").addEventListener("click", () => run("test-tts-result", testTts));
$("list-voices").addEventListener("click", () => run("test-tts-result", listVoices));
$("read").addEventListener("click", () => run("save-status", readSettings));
$("save").addEventListener("click", () => run("save-status", save));
$("ai-preset").addEventListener("change", applyAiPreset);
$("speech-preset").addEventListener("change", applySpeechPreset);
$("speech-server").addEventListener("input", applySpeechPreset);
$("same-key").addEventListener("change", syncKeyFields);
$("tts_voice_pick").addEventListener("change", () => { $("tts_voice").value = $("tts_voice_pick").value; });
for (const key of ["tts_url", "tts_key", "tts_model"]) $(key).addEventListener("input", forgetVoices);
$("persona-default").addEventListener("click", (event) => {
  event.preventDefault();
  $("persona").value = "";
  resetPersona = true;
  log("The default personality will be restored when you save.");
});
applyAiPreset();
applySpeechPreset();
