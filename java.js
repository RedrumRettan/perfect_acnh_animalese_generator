const SOUND_ROOT = "acnh_talking_sounds";

const VOICES = [
  "aneki", "bonyari", "futsu", "genki", "ghost", "hakihaki", "kiza", "kowai", "otona"
];

const VOICE_PREFIX = {
  aneki: "Aneki",
  bonyari: "Bonyari",
  futsu: "Futsu",
  genki: "Genki",
  ghost: "Ghost",
  hakihaki: "Hakihaki",
  kiza: "Kiza",
  kowai: "Kowai",
  otona: "Otona"
};

const LOCALIZATIONS = ["swkbd_en", "swkbd_de"];

const voiceSelect = document.getElementById("voiceSelect");
const localeSelect = document.getElementById("localeSelect");
const textInput = document.getElementById("textInput");
const generateBtn = document.getElementById("generateBtn");
const downloadWavBtn = document.getElementById("downloadWavBtn");
const downloadMp3Btn = document.getElementById("downloadMp3Btn");
const preview = document.getElementById("preview");
const statusEl = document.getElementById("status");

let lastWavBlob = null;
let lastPcmData = null;
let lastSampleRate = 22050;

function setStatus(message) {
  statusEl.textContent = message;
}

function fillSelect(select, items) {
  select.innerHTML = "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    select.appendChild(option);
  });
}

function tokenFromFilename(name) {
  const base = name.replace(".wav", "");
  const parts = base.split("_");
  return parts[parts.length - 1].toLowerCase();
}

async function fileExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function getClipUrl(token, voice, locale) {
  const voicePattern = `${SOUND_ROOT}/${voice}/Voice_`;
  const localePattern = `${SOUND_ROOT}/${locale}/Voice_`;

  const prefix = VOICE_PREFIX[voice];
  if (!prefix) return null;

  const voiceCandidates = [
    `${voicePattern}${prefix}_Kana_${token}.wav`,
    `${voicePattern}${prefix}_KanaEx_${token}.wav`,
    `${voicePattern}${prefix}_Loop_${token}.wav`
  ];

  for (const url of voiceCandidates) {
    if (await fileExists(url)) return url;
  }

  const upper = token.toUpperCase();
  const localeCandidates = [
    `${localePattern}Swkbd_Futsu_Alph_${locale.split("_")[1].toUpperCase()}_${upper}.wav`,
    `${localePattern}Swkbd_Bonyari_Alph_${locale.split("_")[1].toUpperCase()}_${upper}.wav`,
    `${localePattern}Swkbd_Futsu_Digit_${locale.split("_")[1].toUpperCase()}_${upper}.wav`,
    `${localePattern}Swkbd_Bonyari_Digit_${locale.split("_")[1].toUpperCase()}_${upper}.wav`
  ];

  for (const url of localeCandidates) {
    if (await fileExists(url)) return url;
  }

  return null;
}

async function decodeWav(url, audioCtx) {
  const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
  return audioCtx.decodeAudioData(arrayBuffer);
}

function textToTokens(text) {
  return [...text.toLowerCase()].flatMap((char) => {
    if (char === " ") return [" "];
    if (/^[a-z0-9]$/.test(char)) return [char];
    return [];
  });
}

function interleaveMono(buffers, sampleRate) {
  const gap = Math.floor(sampleRate * 0.015);
  const totalLength = buffers.reduce((sum, b) => sum + b.length + gap, 0);
  const output = new Float32Array(totalLength || 1);

  let offset = 0;
  buffers.forEach((buf) => {
    output.set(buf, offset);
    offset += buf.length + gap;
  });

  return output;
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function makeWavBlob(samples, sampleRate = 22050) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: "audio/wav" });
}

function makeMp3Blob(samples, sampleRate = 22050) {
  if (!window.lamejs) throw new Error("lamejs not loaded.");

  const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const pcm = Int16Array.from(samples.map((s) => Math.max(-1, Math.min(1, s)) * 32767));

  const chunk = 1152;
  const mp3Data = [];

  for (let i = 0; i < pcm.length; i += chunk) {
    const sampleChunk = pcm.subarray(i, i + chunk);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }

  const end = mp3encoder.flush();
  if (end.length > 0) mp3Data.push(end);
  return new Blob(mp3Data, { type: "audio/mpeg" });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function generateAudio() {
  const text = textInput.value.trim();
  if (!text) {
    setStatus("Type some text first.");
    return;
  }

  const voice = voiceSelect.value;
  const locale = localeSelect.value;
  setStatus("Generating audio...");
  generateBtn.disabled = true;

  try {
    const tokens = textToTokens(text);
    const audioCtx = new AudioContext();
    const clips = [];
    let misses = 0;

    for (const token of tokens) {
      if (token === " ") {
        clips.push(new Float32Array(Math.floor(audioCtx.sampleRate * 0.07)));
        continue;
      }

      const clipUrl = await getClipUrl(tokenFromFilename(`${token}.wav`), voice, locale);
      if (!clipUrl) {
        misses++;
        continue;
      }

      const decoded = await decodeWav(clipUrl, audioCtx);
      const data = decoded.getChannelData(0);
      clips.push(Float32Array.from(data));
    }

    if (!clips.length) {
      throw new Error("No matching clips found for your text.");
    }

    const merged = interleaveMono(clips, audioCtx.sampleRate);
    const wavBlob = makeWavBlob(merged, audioCtx.sampleRate);

    lastWavBlob = wavBlob;
    lastPcmData = merged;
    lastSampleRate = audioCtx.sampleRate;

    const url = URL.createObjectURL(wavBlob);
    preview.src = url;
    preview.play();

    downloadWavBtn.disabled = false;
    downloadMp3Btn.disabled = false;
    setStatus(`Done. Unmatched characters skipped: ${misses}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generateAudio);

downloadWavBtn.addEventListener("click", () => {
  if (!lastWavBlob) return;
  triggerDownload(lastWavBlob, "animalese.wav");
});

downloadMp3Btn.addEventListener("click", () => {
  if (!lastPcmData) return;
  try {
    const mp3 = makeMp3Blob(lastPcmData, lastSampleRate);
    triggerDownload(mp3, "animalese.mp3");
  } catch (error) {
    setStatus(`MP3 export failed: ${error.message}`);
  }
});

fillSelect(voiceSelect, VOICES);
fillSelect(localeSelect, LOCALIZATIONS);
localeSelect.value = "swkbd_en";
textInput.value = "hello world 123";
setStatus("Ready.");
