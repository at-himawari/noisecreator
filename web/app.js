const SAMPLE_RATE = 44100;
const MP3_BITRATE = 192;
const MP3_BLOCK_SIZE = 1152;

const duration = document.querySelector("#duration");
const intensity = document.querySelector("#intensity");
const continuous = document.querySelector("#continuous");
const durationValue = document.querySelector("#duration-value");
const intensityValue = document.querySelector("#intensity-value");
const buttonTime = document.querySelector("#button-time");
const generateButton = document.querySelector("#generate");
const status = document.querySelector("#status");
const playerPanel = document.querySelector("#player-panel");
const player = document.querySelector("#player");
const download = document.querySelector("#download");
const blackoutTrigger = document.querySelector("#blackout-trigger");
const blackoutScreen = document.querySelector("#blackout-screen");

let currentAudioUrl = null;
let decodedRain = null;
let continuousSession = null;
let blackoutReturnFocus = null;

function enterBlackout() {
  blackoutReturnFocus = document.activeElement;
  blackoutScreen.hidden = false;
  document.body.style.overflow = "hidden";
  blackoutScreen.focus();
}

function exitBlackout() {
  blackoutScreen.hidden = true;
  document.body.style.overflow = "";
  if (blackoutReturnFocus instanceof HTMLElement) blackoutReturnFocus.focus();
  blackoutReturnFocus = null;
}

blackoutTrigger.addEventListener("click", enterBlackout);
blackoutScreen.addEventListener("click", exitBlackout);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !blackoutScreen.hidden) exitBlackout();
});

function decodeBase64Audio(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function loadRainRecording() {
  if (decodedRain) return decodedRain;
  if (!globalThis.RAIN_SOURCE_BASE64) {
    throw new Error("雨音素材を読み込めませんでした");
  }
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザは音声処理に対応していません");
  const audioContext = new AudioContextClass({ sampleRate: SAMPLE_RATE });
  try {
    decodedRain = await audioContext.decodeAudioData(decodeBase64Audio(globalThis.RAIN_SOURCE_BASE64));
    return decodedRain;
  } finally {
    await audioContext.close();
  }
}

function sampleAt(data, position) {
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, data.length - 1);
  const mix = position - lower;
  return data[lower] * (1 - mix) + data[upper] * mix;
}

function loopedSample(data, sourcePosition, start, end, crossfadeLength) {
  const loopLength = end - start;
  const relative = ((sourcePosition - start) % loopLength + loopLength) % loopLength;
  const position = start + relative;
  if (relative < loopLength - crossfadeLength) return sampleAt(data, position);

  const blend = (relative - (loopLength - crossfadeLength)) / crossfadeLength;
  const beginningPosition = start + relative - (loopLength - crossfadeLength);
  const endingGain = Math.cos(blend * Math.PI * 0.5);
  const beginningGain = Math.sin(blend * Math.PI * 0.5);
  return sampleAt(data, position) * endingGain + sampleAt(data, beginningPosition) * beginningGain;
}

function toPcm16(sample) {
  return Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
}

async function generateMp3(seconds, amount, onProgress) {
  if (!globalThis.lamejs?.Mp3Encoder) {
    throw new Error("MP3エンコーダーを読み込めませんでした");
  }

  onProgress(1, "実録音源を準備中");
  const recording = await loadRainRecording();
  const source = recording.getChannelData(0);
  const sourceRatio = recording.sampleRate / SAMPLE_RATE;
  const loopStart = Math.round(recording.sampleRate * 1.2);
  const loopEnd = source.length - Math.round(recording.sampleRate * 1.2);
  const crossfadeLength = Math.round(recording.sampleRate * 2.8);
  const randomStart = loopStart + Math.random() * (loopEnd - loopStart - crossfadeLength);
  const layers = amount < 0.34 ? [0] : amount < 0.72 ? [0, 11.37] : [0, 11.37, 24.83];
  const layerScale = (0.58 + amount * 0.34) / Math.sqrt(layers.length);
  const encoder = new lamejs.Mp3Encoder(2, SAMPLE_RATE, MP3_BITRATE);
  const totalFrames = Math.round(seconds * SAMPLE_RATE);
  const totalBlocks = Math.ceil(totalFrames / MP3_BLOCK_SIZE);
  const mp3Chunks = [];

  for (let block = 0; block < totalBlocks; block += 1) {
    const startFrame = block * MP3_BLOCK_SIZE;
    const frameCount = Math.min(MP3_BLOCK_SIZE, totalFrames - startFrame);
    const leftPcm = new Int16Array(frameCount);
    const rightPcm = new Int16Array(frameCount);

    for (let local = 0; local < frameCount; local += 1) {
      const frame = startFrame + local;
      const basePosition = randomStart + frame * sourceRatio;
      let left = 0;
      let right = 0;

      for (let layer = 0; layer < layers.length; layer += 1) {
        const offset = layers[layer] * recording.sampleRate;
        left += loopedSample(source, basePosition + offset, loopStart, loopEnd, crossfadeLength);
        // The base layer stays centered; added layers widen heavier rainfall.
        const stereoOffset = layer === 0 ? 0 : (0.41 + layer * 0.27) * recording.sampleRate;
        right += loopedSample(source, basePosition + offset + stereoOffset, loopStart, loopEnd, crossfadeLength);
      }

      leftPcm[local] = toPcm16(left * layerScale);
      rightPcm[local] = toPcm16(right * layerScale);
    }

    const encoded = encoder.encodeBuffer(leftPcm, rightPcm);
    if (encoded.length) mp3Chunks.push(new Uint8Array(encoded));

    if (block % 32 === 0 || block === totalBlocks - 1) {
      const progress = Math.max(2, Math.round(((block + 1) / totalBlocks) * 100));
      onProgress(progress, `MP3を生成中 ${progress}%`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const finalChunk = encoder.flush();
  if (finalChunk.length) mp3Chunks.push(new Uint8Array(finalChunk));
  return new Blob(mp3Chunks, { type: "audio/mpeg" });
}

function createSeamlessLoop(audioContext, recording) {
  const source = recording.getChannelData(0);
  const trim = Math.round(recording.sampleRate * 1.2);
  const crossfade = Math.round(recording.sampleRate * 2.8);
  const segmentLength = source.length - trim * 2;
  const loopLength = segmentLength - crossfade;
  const bodyLength = loopLength - crossfade;
  const loop = audioContext.createBuffer(1, loopLength, recording.sampleRate);
  const output = loop.getChannelData(0);

  for (let index = 0; index < bodyLength; index += 1) {
    output[index] = source[trim + crossfade + index];
  }
  for (let index = 0; index < crossfade; index += 1) {
    const blend = index / crossfade;
    const tail = source[trim + crossfade + bodyLength + index];
    const head = source[trim + index];
    output[bodyLength + index] = tail * Math.cos(blend * Math.PI * 0.5)
      + head * Math.sin(blend * Math.PI * 0.5);
  }
  return loop;
}

async function startContinuousPlayback(amount) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const audioContext = new AudioContextClass({ sampleRate: SAMPLE_RATE });
  await audioContext.resume();
  const recording = await loadRainRecording();
  const seamlessLoop = createSeamlessLoop(audioContext, recording);
  const masterGain = audioContext.createGain();
  const now = audioContext.currentTime;
  masterGain.gain.setValueAtTime(0.82, now);
  masterGain.connect(audioContext.destination);

  const layerCount = amount < 0.34 ? 1 : amount < 0.72 ? 2 : 3;
  const sources = [];
  const perLayerGain = (0.64 + amount * 0.26) / Math.sqrt(layerCount);
  for (let layer = 0; layer < layerCount; layer += 1) {
    const source = audioContext.createBufferSource();
    const layerGain = audioContext.createGain();
    source.buffer = seamlessLoop;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = seamlessLoop.duration;
    layerGain.gain.value = perLayerGain;
    source.connect(layerGain);

    if (audioContext.createStereoPanner && layer > 0) {
      const panner = audioContext.createStereoPanner();
      panner.pan.value = layer % 2 ? -0.32 : 0.32;
      layerGain.connect(panner);
      panner.connect(masterGain);
    } else {
      layerGain.connect(masterGain);
    }

    const available = source.loopEnd;
    const offset = (Math.random() * available + layer * 11.37) % available;
    source.start(now, offset);
    sources.push(source);
  }

  continuousSession = { audioContext, masterGain, sources };
}

async function stopContinuousPlayback() {
  if (!continuousSession) return;
  const session = continuousSession;
  continuousSession = null;
  for (const source of session.sources) {
    try { source.stop(); } catch {}
  }
  await session.audioContext.close();
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateControls() {
  const seconds = Number(duration.value);
  durationValue.value = seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60 ? `${seconds % 60}秒` : ""}`;
  buttonTime.textContent = continuousSession ? "LIVE" : continuous.checked ? "∞" : formatDuration(seconds);

  const amount = Number(intensity.value);
  intensityValue.value = amount < 0.34 ? "静かな小雨" : amount < 0.72 ? "穏やか" : "しっかりした雨";
}

function updateMode() {
  duration.disabled = continuous.checked;
  document.querySelector(".button-text").textContent = continuous.checked ? "連続再生を開始" : "雨音を生成する";
  buttonTime.textContent = continuous.checked ? "∞" : formatDuration(Number(duration.value));
}

duration.addEventListener("input", updateControls);
intensity.addEventListener("input", updateControls);
continuous.addEventListener("change", updateMode);

generateButton.addEventListener("click", async () => {
  if (continuousSession) {
    generateButton.disabled = true;
    status.textContent = "停止中…";
    await stopContinuousPlayback();
    generateButton.disabled = false;
    continuous.disabled = false;
    intensity.disabled = false;
    document.querySelector(".button-text").textContent = "連続再生を開始";
    status.textContent = "停止しました";
    return;
  }

  generateButton.disabled = true;
  duration.disabled = true;
  intensity.disabled = true;
  continuous.disabled = true;
  status.textContent = continuous.checked ? "連続再生を準備中" : "実録音源を準備中";
  status.classList.add("busy");
  try {
    if (continuous.checked) {
      await startContinuousPlayback(Number(intensity.value));
      player.pause();
      status.textContent = "連続再生中";
      document.querySelector(".button-text").textContent = "停止する";
      buttonTime.textContent = "LIVE";
      generateButton.disabled = false;
      intensity.disabled = false;
      return;
    }

    const seconds = Number(duration.value);
    const audio = await generateMp3(seconds, Number(intensity.value), (_progress, label) => {
      status.textContent = label;
    });
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(audio);
    player.src = currentAudioUrl;
    download.href = currentAudioUrl;
    download.download = `rain-${seconds}s.mp3`;
    playerPanel.hidden = false;
    status.textContent = "生成完了";
    playerPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    await player.play().catch(() => {});
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "エラーが発生しました";
  } finally {
    if (!continuousSession) {
      generateButton.disabled = false;
      duration.disabled = continuous.checked;
      intensity.disabled = false;
      continuous.disabled = false;
    }
    status.classList.remove("busy");
  }
});

updateControls();
updateMode();
