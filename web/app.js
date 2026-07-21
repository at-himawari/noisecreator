const SAMPLE_RATE = 44100;
const MP3_BITRATE = 192;
const MP3_BLOCK_SIZE = 1152;

const TWO_PI = Math.PI * 2;

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
let regenerationTimer = null;

function trackEvent(eventName, parameters = {}) {
  if (typeof globalThis.gtag === "function") {
    globalThis.gtag("event", eventName, parameters);
  }
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function hideBlackout() {
  if (blackoutScreen.hidden) return;
  blackoutScreen.hidden = true;
  document.body.style.overflow = "";
  if (blackoutReturnFocus instanceof HTMLElement) blackoutReturnFocus.focus();
  blackoutReturnFocus = null;
}

async function enterBlackout() {
  blackoutReturnFocus = document.activeElement;
  blackoutScreen.hidden = false;
  document.body.style.overflow = "hidden";
  blackoutScreen.focus();
  try {
    if (blackoutScreen.requestFullscreen) {
      await blackoutScreen.requestFullscreen({ navigationUI: "hide" });
    } else if (blackoutScreen.webkitRequestFullscreen) {
      blackoutScreen.webkitRequestFullscreen();
    }
  } catch {
    // The fixed overlay remains available when fullscreen is blocked.
  }
}

async function exitBlackout() {
  try {
    if (document.exitFullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen && document.webkitFullscreenElement) {
      document.webkitExitFullscreen();
    }
  } catch {
    // Keep the exit control responsive even if the browser rejects the request.
  } finally {
    hideBlackout();
  }
}

blackoutTrigger.addEventListener("click", enterBlackout);
blackoutScreen.addEventListener("click", exitBlackout);
document.addEventListener("fullscreenchange", () => {
  if (!fullscreenElement()) hideBlackout();
});
document.addEventListener("webkitfullscreenchange", () => {
  if (!fullscreenElement()) hideBlackout();
});
player.addEventListener("play", () => {
  trackEvent("rain_audio_play", {
    duration_seconds: Number(duration.value),
    intensity: Number(intensity.value),
  });
});
download.addEventListener("click", () => {
  trackEvent("rain_audio_download", {
    duration_seconds: Number(duration.value),
    intensity: Number(intensity.value),
  });
});
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

function createRandom(seed = Math.floor(Math.random() * 0xffffffff)) {
  let state = seed || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function exponentialInterval(random, ratePerSecond) {
  return -Math.log(Math.max(1e-9, 1 - random())) * SAMPLE_RATE / ratePerSecond;
}

function smoothstep(edge0, edge1, value) {
  const progress = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function rainLayerLevels(amount, layerCount = 4) {
  const value = Math.max(0, Math.min(1, Number(amount)));
  const rawLevels = [
    1,
    smoothstep(0.28, 0.55, value) * 0.65,
    smoothstep(0.52, 0.78, value) * 0.45,
    smoothstep(0.74, 1, value) * 0.32,
  ].slice(0, layerCount);
  const energy = Math.sqrt(rawLevels.reduce((sum, level) => sum + level * level, 0));
  return rawLevels.map((level) => level / Math.max(energy, 1e-9));
}

function rainBackgroundGain(amount) {
  const value = Math.max(0, Math.min(1, Number(amount)));
  return 0.015 + Math.pow(value, 1.8) * 0.72;
}

function createDropRates(amount) {
  const value = Math.max(0, Math.min(1, Number(amount)));
  return {
    small: 0.3 + Math.pow(value, 1.8) * 28,
    medium: 0.18 + Math.pow(value, 1.4) * 7,
    large: 0.01 + Math.pow(value, 2.4) * 1.5,
  };
}

function createIntensityCurve(totalFrames, amount, random) {
  const points = [{ frame: 0, value: 0.88 + random() * 0.18 }];
  let frame = 0;
  while (frame < totalFrames) {
    frame += Math.round((4 + random() * 9) * SAMPLE_RATE);
    const variation = 0.08 + (1 - amount) * 0.2;
    points.push({
      frame: Math.min(frame, totalFrames),
      value: 1 - variation + random() * variation * 2,
    });
  }

  let index = 0;
  return (currentFrame) => {
    while (index + 1 < points.length - 1 && currentFrame > points[index + 1].frame) index += 1;
    const from = points[index];
    const to = points[index + 1] || from;
    const distance = Math.max(1, to.frame - from.frame);
    const progress = Math.max(0, Math.min(1, (currentFrame - from.frame) / distance));
    const smooth = progress * progress * (3 - 2 * progress);
    return from.value + (to.value - from.value) * smooth;
  };
}

function createDrop(random, size, intensityScale) {
  const isLarge = size === "large";
  const isMedium = size === "medium";
  const duration = isLarge
    ? 0.035 + random() * 0.08
    : isMedium ? 0.018 + random() * 0.055 : 0.006 + random() * 0.018;
  const pan = random() * 1.8 - 0.9;
  const amplitude = (
    isLarge ? 0.012 + random() * 0.03
      : isMedium ? 0.007 + random() * 0.018 : 0.0015 + random() * 0.005
  ) * intensityScale;
  const baseFrequency = isLarge
    ? 250 + Math.pow(random(), 2) * 850
    : isMedium ? 480 + random() * 1500 : 1200 + random() * 2800;
  return {
    age: 0,
    durationFrames: Math.max(1, Math.round(duration * SAMPLE_RATE)),
    decay: isLarge ? 8 + random() * 6 : isMedium ? 10 + random() * 8 : 12 + random() * 12,
    leftGain: Math.sqrt((1 - pan) * 0.5),
    rightGain: Math.sqrt((1 + pan) * 0.5),
    amplitude,
    phase1: random() * TWO_PI,
    phase2: random() * TWO_PI,
    phaseStep1: TWO_PI * baseFrequency / SAMPLE_RATE,
    phaseStep2: TWO_PI * baseFrequency * (1.43 + random() * 0.38) / SAMPLE_RATE,
    noiseState1: 0,
    noiseState2: 0,
    noiseSmoothing: isLarge ? 0.08 + random() * 0.08 : isMedium ? 0.13 + random() * 0.1 : 0.2 + random() * 0.18,
    resonanceMix: isLarge
      ? 0.035 + random() * 0.04
      : isMedium ? 0.025 + random() * 0.025 : 0.005 + random() * 0.012,
  };
}

function renderDrops(activeDrops, random) {
  let left = 0;
  let right = 0;
  for (let index = activeDrops.length - 1; index >= 0; index -= 1) {
    const drop = activeDrops[index];
    const progress = drop.age / drop.durationFrames;
    if (progress >= 1) {
      activeDrops.splice(index, 1);
      continue;
    }
    const attack = Math.min(1, drop.age / Math.max(1, SAMPLE_RATE * 0.0006));
    const envelope = attack * Math.exp(-drop.decay * progress) * Math.pow(1 - progress, 1.5);
    const whiteNoise = random() * 2 - 1;
    drop.noiseState1 += (whiteNoise - drop.noiseState1) * drop.noiseSmoothing;
    drop.noiseState2 += (drop.noiseState1 - drop.noiseState2) * drop.noiseSmoothing * 0.65;
    const texturedNoise = drop.noiseState1 * 0.72 + (drop.noiseState1 - drop.noiseState2) * 0.55;
    const resonance = Math.sin(drop.phase1) * 0.7 + Math.sin(drop.phase2) * 0.3;
    const resonanceEnvelope = Math.exp(-18 * progress);
    const sample = (
      texturedNoise * (1 - drop.resonanceMix)
      + resonance * drop.resonanceMix * resonanceEnvelope
    ) * envelope * drop.amplitude;
    left += sample * drop.leftGain;
    right += sample * drop.rightGain;
    const pitchDecay = 1 - progress * 0.025;
    drop.phase1 += drop.phaseStep1 * pitchDecay;
    drop.phase2 += drop.phaseStep2 * pitchDecay;
    drop.age += 1;
  }
  return [left, right];
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
  const layers = [0, 9.73, 19.61, 29.47];
  const layerLevels = rainLayerLevels(amount, layers.length);
  const baseBackgroundGain = rainBackgroundGain(amount);
  const encoder = new lamejs.Mp3Encoder(2, SAMPLE_RATE, MP3_BITRATE);
  const totalFrames = Math.round(seconds * SAMPLE_RATE);
  const totalBlocks = Math.ceil(totalFrames / MP3_BLOCK_SIZE);
  const mp3Chunks = [];
  const random = createRandom();
  const intensityAt = createIntensityCurve(totalFrames, amount, random);
  const activeDrops = [];
  const dropRates = createDropRates(amount);
  let nextSmallDrop = exponentialInterval(random, dropRates.small);
  let nextMediumDrop = exponentialInterval(random, dropRates.medium);
  let nextLargeDrop = exponentialInterval(random, dropRates.large);

  for (let block = 0; block < totalBlocks; block += 1) {
    const startFrame = block * MP3_BLOCK_SIZE;
    const frameCount = Math.min(MP3_BLOCK_SIZE, totalFrames - startFrame);
    const leftPcm = new Int16Array(frameCount);
    const rightPcm = new Int16Array(frameCount);

    for (let local = 0; local < frameCount; local += 1) {
      const frame = startFrame + local;
      const basePosition = randomStart + frame * sourceRatio;
      const currentIntensity = intensityAt(frame);
      let left = 0;
      let right = 0;

      for (let layer = 0; layer < layers.length; layer += 1) {
        const offset = layers[layer] * recording.sampleRate;
        left += loopedSample(source, basePosition + offset, loopStart, loopEnd, crossfadeLength)
          * layerLevels[layer];
        // The base layer stays centered; added layers widen heavier rainfall.
        const stereoOffset = layer === 0 ? 0 : (0.41 + layer * 0.27) * recording.sampleRate;
        right += loopedSample(source, basePosition + offset + stereoOffset, loopStart, loopEnd, crossfadeLength)
          * layerLevels[layer];
      }

      while (frame >= nextSmallDrop) {
        activeDrops.push(createDrop(random, "small", 0.8 + amount * 0.35));
        nextSmallDrop += exponentialInterval(random, dropRates.small * currentIntensity);
      }
      while (frame >= nextMediumDrop) {
        activeDrops.push(createDrop(random, "medium", 0.9 + amount * 0.3));
        nextMediumDrop += exponentialInterval(random, dropRates.medium * currentIntensity);
      }
      while (frame >= nextLargeDrop) {
        activeDrops.push(createDrop(random, "large", 0.85 + amount * 0.35));
        nextLargeDrop += exponentialInterval(random, dropRates.large * currentIntensity);
      }
      const [dropLeft, dropRight] = renderDrops(activeDrops, random);
      const backgroundGain = baseBackgroundGain * currentIntensity
        * (0.98 + Math.sin(frame / SAMPLE_RATE * 0.071) * 0.012);
      leftPcm[local] = toPcm16(left * backgroundGain + dropLeft);
      rightPcm[local] = toPcm16(right * backgroundGain + dropRight);
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
  const intensityGain = audioContext.createGain();
  const variationGain = audioContext.createGain();
  const now = audioContext.currentTime;
  intensityGain.gain.setValueAtTime(rainBackgroundGain(amount), now);
  variationGain.gain.setValueAtTime(0, now);
  intensityGain.connect(variationGain);
  variationGain.connect(audioContext.destination);

  const sources = [];
  const layerGains = [];
  const initialLayerLevels = rainLayerLevels(amount);
  for (let layer = 0; layer < initialLayerLevels.length; layer += 1) {
    const source = audioContext.createBufferSource();
    const layerGain = audioContext.createGain();
    source.buffer = seamlessLoop;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = seamlessLoop.duration;
    layerGain.gain.value = initialLayerLevels[layer];
    source.connect(layerGain);

    if (audioContext.createStereoPanner && layer > 0) {
      const panner = audioContext.createStereoPanner();
      panner.pan.value = layer % 2 ? -0.32 : 0.32;
      layerGain.connect(panner);
      panner.connect(intensityGain);
    } else {
      layerGain.connect(intensityGain);
    }

    const available = source.loopEnd;
    const offset = (Math.random() * available + layer * 11.37) % available;
    source.start(now, offset);
    sources.push(source);
    layerGains.push(layerGain);
  }

  const variationEnd = now + 60 * 60;
  let variationTime = now;
  let previousGain = 0.9 + Math.random() * 0.12;
  variationGain.gain.linearRampToValueAtTime(previousGain, now + 1.2);
  variationTime = now + 1.2;
  while (variationTime < variationEnd) {
    variationTime += 4 + Math.random() * 9;
    const variation = 0.08 + (1 - amount) * 0.2;
    previousGain = 1 - variation + Math.random() * variation * 2;
    variationGain.gain.linearRampToValueAtTime(previousGain, variationTime);
  }

  for (const source of sources) source.playbackRate.setValueAtTime(1, now);

  continuousSession = {
    audioContext,
    intensityGain,
    variationGain,
    sources,
    layerGains,
    liveDropSources: new Set(),
    dropTimer: null,
    amount,
  };
  scheduleContinuousDrops(continuousSession);
}

function playContinuousDrop(session, size, startTime) {
  const random = createRandom();
  const drop = createDrop(random, size, 1);
  const buffer = session.audioContext.createBuffer(2, drop.durationFrames, SAMPLE_RATE);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const activeDrops = [drop];
  for (let frame = 0; frame < drop.durationFrames; frame += 1) {
    const sample = renderDrops(activeDrops, random);
    left[frame] = sample[0];
    right[frame] = sample[1];
  }
  const source = session.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(session.variationGain);
  source.onended = () => session.liveDropSources.delete(source);
  session.liveDropSources.add(source);
  source.start(startTime);
}

function scheduleContinuousDrops(session) {
  const intervalSeconds = 0.25;
  const rates = createDropRates(session.amount);
  const now = session.audioContext.currentTime;
  for (const size of ["small", "medium", "large"]) {
    const expected = rates[size] * intervalSeconds;
    const guaranteed = Math.floor(expected);
    const count = guaranteed + (Math.random() < expected - guaranteed ? 1 : 0);
    for (let index = 0; index < count; index += 1) {
      playContinuousDrop(session, size, now + Math.random() * intervalSeconds);
    }
  }
  session.dropTimer = setTimeout(() => scheduleContinuousDrops(session), intervalSeconds * 1000);
}

function updateContinuousIntensity(amount) {
  if (!continuousSession) return;
  const { audioContext, intensityGain, layerGains } = continuousSession;
  continuousSession.amount = amount;
  const now = audioContext.currentTime;
  const levels = rainLayerLevels(amount, layerGains.length);
  for (let index = 0; index < layerGains.length; index += 1) {
    const gain = layerGains[index].gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(levels[index], now, 0.12);
  }
  intensityGain.gain.cancelScheduledValues(now);
  intensityGain.gain.setTargetAtTime(rainBackgroundGain(amount), now, 0.18);
}

async function stopContinuousPlayback() {
  if (!continuousSession) return;
  const session = continuousSession;
  continuousSession = null;
  if (session.dropTimer) clearTimeout(session.dropTimer);
  for (const source of session.sources) {
    try { source.stop(); } catch {}
  }
  for (const source of session.liveDropSources) {
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
  const label = amount < 0.34 ? "静かな小雨" : amount < 0.72 ? "穏やか" : "しっかりした雨";
  intensityValue.value = `${label} ${Math.round(amount * 100)}%`;
}

function updateMode() {
  if (regenerationTimer) {
    clearTimeout(regenerationTimer);
    regenerationTimer = null;
  }
  duration.disabled = continuous.checked;
  document.querySelector(".button-text").textContent = continuous.checked ? "連続再生を開始" : "雨音を生成する";
  buttonTime.textContent = continuous.checked ? "∞" : formatDuration(Number(duration.value));
}

duration.addEventListener("input", () => {
  updateControls();
  if (currentAudioUrl && !continuousSession) status.textContent = "長さを変更しました。再生成してください";
});
intensity.addEventListener("input", () => {
  updateControls();
  const amount = Number(intensity.value);
  if (continuousSession) {
    updateContinuousIntensity(amount);
    status.textContent = `連続再生中・雨量 ${Math.round(amount * 100)}%`;
  } else if (currentAudioUrl) {
    if (regenerationTimer) clearTimeout(regenerationTimer);
    status.textContent = "雨量を変更中…";
    regenerationTimer = setTimeout(() => {
      regenerationTimer = null;
      status.textContent = "新しい雨量で再生成します";
      generateButton.click();
    }, 450);
  }
});
continuous.addEventListener("change", updateMode);

generateButton.addEventListener("click", async () => {
  if (regenerationTimer) {
    clearTimeout(regenerationTimer);
    regenerationTimer = null;
  }
  if (continuousSession) {
    generateButton.disabled = true;
    status.textContent = "停止中…";
    await stopContinuousPlayback();
    trackEvent("continuous_playback_stop");
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
      trackEvent("continuous_playback_start", {
        intensity: Number(intensity.value),
      });
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
    trackEvent("rain_audio_generated", {
      duration_seconds: seconds,
      intensity: Number(intensity.value),
    });
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
