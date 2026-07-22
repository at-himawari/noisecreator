const SAMPLE_RATE = 44100;
const MP3_BITRATE = 192;
const MP3_BLOCK_SIZE = 1152;
const RAIN_BED_FREQUENCIES = [90, 1100, 650, 4200, 3800, 10500];
const RAIN_BED_ALPHAS = RAIN_BED_FREQUENCIES.map(
  (frequency) => 1 - Math.exp(-2 * Math.PI * frequency / SAMPLE_RATE),
);

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
const languageButtons = document.querySelectorAll("[data-locale]");

const translations = {
  ja: {
    pageTitle: "Rain Studio — 雨音ジェネレーター",
    description: "長さと雨量を選んで自然な雨音を生成・再生できます。",
    lead: "集中したい時間に、眠りにつく前に。<br>あなただけの雨を、その場でつくります。",
    settingsTitle: "雨の設定", duration: "長さ", intensity: "雨量", fiveSeconds: "5秒", tenMinutes: "10分",
    lightRain: "小雨", heavyRain: "強い雨", continuousMode: "連続モード",
    continuousDescription: "停止するまで雨音を再生し続けます", generate: "雨音を生成する",
    startContinuous: "連続再生を開始", stop: "停止する", blackout: "画面を消灯する",
    exitBlackout: "画面の消灯を解除する", generatedRain: "生成した雨音", saveMp3: "MP3を保存",
    ready: "準備完了", seconds: "{value}秒", minutes: "{minutes}分{seconds}",
    intensityQuiet: "静かな小雨", intensityGentle: "穏やか", intensitySteady: "しっかりした雨",
    encoderMissing: "MP3エンコーダーを読み込めませんでした", preparingRain: "雨音を準備中",
    generating: "MP3を生成中 {progress}%", durationChanged: "長さを変更しました。再生成してください",
    continuousPlayingAmount: "連続再生中・雨量 {amount}%", changingIntensity: "雨量を変更中…",
    regenerating: "新しい雨量で再生成します", stopping: "停止中…", stopped: "停止しました",
    preparingContinuous: "連続再生を準備中", continuousPlaying: "連続再生中", complete: "生成完了",
    genericError: "エラーが発生しました",
  },
  en: {
    pageTitle: "Rain Studio — Rain Sound Generator",
    description: "Choose a duration and intensity to generate and play natural rain sounds.",
    lead: "For focused hours and quiet nights.<br>Create your own rain, right in the browser.",
    settingsTitle: "Rain settings", duration: "Duration", intensity: "Intensity", fiveSeconds: "5 sec", tenMinutes: "10 min",
    lightRain: "Light rain", heavyRain: "Heavy rain", continuousMode: "Continuous mode",
    continuousDescription: "Keep playing until you stop it", generate: "Generate rain sound",
    startContinuous: "Start continuous playback", stop: "Stop", blackout: "Blackout screen",
    exitBlackout: "Exit blackout mode", generatedRain: "Generated rain", saveMp3: "Save MP3",
    ready: "Ready", seconds: "{value} sec", minutes: "{minutes} min {seconds}",
    intensityQuiet: "Sparse drizzle", intensityGentle: "Gentle rain", intensitySteady: "Steady rain",
    encoderMissing: "The MP3 encoder could not be loaded.", preparingRain: "Preparing rain sound",
    generating: "Generating MP3 {progress}%", durationChanged: "Duration changed. Generate again to apply it.",
    continuousPlayingAmount: "Playing continuously · Intensity {amount}%", changingIntensity: "Changing intensity…",
    regenerating: "Regenerating with the new intensity", stopping: "Stopping…", stopped: "Stopped",
    preparingContinuous: "Preparing continuous playback", continuousPlaying: "Playing continuously", complete: "Generation complete",
    genericError: "An error occurred.",
  },
};

let locale = (() => {
  try {
    const saved = localStorage.getItem("rain-studio-locale");
    if (saved === "ja" || saved === "en") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
})();
let statusKey = "ready";
let statusParameters = {};

function t(key, parameters = {}) {
  const template = translations[locale][key] ?? translations.ja[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => parameters[name] ?? "");
}

function setStatus(key, parameters = {}) {
  statusKey = key;
  statusParameters = parameters;
  status.textContent = t(key, parameters);
}

function applyLocale(nextLocale) {
  locale = nextLocale === "en" ? "en" : "ja";
  document.documentElement.lang = locale;
  document.title = t("pageTitle");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("description"));
  document.querySelector('meta[property="og:locale"]')?.setAttribute("content", locale === "ja" ? "ja_JP" : "en_US");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", t("pageTitle"));
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", t("description"));
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", t("pageTitle"));
  document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", t("description"));
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  languageButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  });
  try { localStorage.setItem("rain-studio-locale", locale); } catch {}
  setStatus(statusKey, statusParameters);
  updateControls();
  updateMode();
}

let currentAudioUrl = null;
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

function rainBedGains(amount) {
  const value = Math.max(0, Math.min(1, Number(amount)));
  const density = Math.pow(value, 1.7);
  return {
    distance: 0.006 + density * 0.04,
    body: 0.008 + density * 0.11,
    mist: 0.002 + density * 0.05,
  };
}

function createDropRates(amount) {
  const value = Math.max(0, Math.min(1, Number(amount)));
  return {
    small: 0.3 + Math.pow(value, 1.8) * 28,
    medium: 0.55 + Math.pow(value, 1.4) * 8.5,
    large: 0.025 + Math.pow(value, 2.4) * 1.7,
    drip: 0.35 + Math.pow(value, 0.8) * 1.2,
  };
}

function createIntensityCurve(totalFrames, amount, random) {
  const points = [{ frame: 0, value: 0.88 + random() * 0.18 }];
  let frame = 0;
  while (frame < totalFrames) {
    frame += Math.round((4 + random() * 9) * SAMPLE_RATE);
    const variation = 0.04 + (1 - amount) * 0.08;
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
  const isDrip = size === "drip";
  const surfaceValue = random();
  const puddleThreshold = isLarge ? 0.35 : isMedium ? 0.52 : 0.9;
  const hardThreshold = isLarge ? 0.18 : isMedium ? 0.28 : 0.55;
  const surface = isDrip ? "puddle" : surfaceValue >= puddleThreshold
    ? "puddle" : surfaceValue >= hardThreshold ? "hard" : "soft";
  const surfaceDurationScale = surface === "puddle" ? 1.45 : surface === "hard" ? 0.85 : 1;
  const duration = (isDrip ? 0.065 + random() * 0.07 : isLarge
    ? 0.035 + random() * 0.08
    : isMedium ? 0.018 + random() * 0.055 : 0.006 + random() * 0.018) * surfaceDurationScale;
  const panRange = isDrip ? 0.48 : 0.9;
  const pan = (random() * 2 - 1) * panRange;
  const amplitude = (
    isDrip ? 0.38 + random() * 0.24
      : isLarge ? 0.055 + random() * 0.065
      : isMedium ? 0.04 + random() * 0.055 : 0.0015 + random() * 0.005
  ) * intensityScale * (surface === "puddle" && !isDrip ? 2.2 : 1);
  const impactFrequency = surface === "soft"
    ? 1800 + random() * 2500
    : surface === "hard" ? 4500 + random() * 4500 : 1200 + random() * 1800;
  const resonanceFrequency = surface === "soft"
    ? 400 + random() * 700
    : surface === "hard" ? 1200 + random() * 2400 : 300 + random() * 700;
  const impactAlpha = 1 - Math.exp(-2 * Math.PI * impactFrequency / SAMPLE_RATE);
  const resonanceAlpha = 1 - Math.exp(-2 * Math.PI * resonanceFrequency / SAMPLE_RATE);
  return {
    age: 0,
    durationFrames: Math.max(1, Math.round(duration * SAMPLE_RATE)),
    decay: isDrip ? 5 + random() * 3 : isLarge ? 8 + random() * 6 : isMedium ? 10 + random() * 8 : 12 + random() * 12,
    leftGain: Math.sqrt((1 - pan) * 0.5),
    rightGain: Math.sqrt((1 + pan) * 0.5),
    amplitude,
    impactFast: 0,
    impactSlow: 0,
    resonanceFast: 0,
    resonanceSlow: 0,
    impactAlpha,
    impactSlowAlpha: impactAlpha * (surface === "hard" ? 0.42 : 0.58),
    resonanceAlpha,
    resonanceSlowAlpha: resonanceAlpha * (surface === "puddle" ? 0.34 : 0.52),
    resonanceMix: surface === "puddle"
      ? 0.24 + random() * 0.06
      : surface === "hard" ? 0.1 + random() * 0.08 : 0.06 + random() * 0.06,
    impactPresence: isDrip ? 1.35 : 1,
    surface,
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
    const whiteNoise = (random() * 2 - 1) * (0.55 + random() * 0.45);
    drop.impactFast += (whiteNoise - drop.impactFast) * drop.impactAlpha;
    drop.impactSlow += (whiteNoise - drop.impactSlow) * drop.impactSlowAlpha;
    drop.resonanceFast += (whiteNoise - drop.resonanceFast) * drop.resonanceAlpha;
    drop.resonanceSlow += (whiteNoise - drop.resonanceSlow) * drop.resonanceSlowAlpha;
    const impact = drop.impactFast - drop.impactSlow;
    const resonance = drop.resonanceFast - drop.resonanceSlow;
    const resonanceEnvelope = Math.exp(-(drop.surface === "puddle" ? 7 : 13) * progress);
    const landingBody = drop.surface === "puddle"
      ? drop.resonanceFast * 3.8 + resonance * 1.6
      : resonance;
    const sample = (
      impact * (1 - drop.resonanceMix) * drop.impactPresence
      + landingBody * drop.resonanceMix * resonanceEnvelope
    ) * envelope * drop.amplitude;
    left += sample * drop.leftGain;
    right += sample * drop.rightGain;
    drop.age += 1;
  }
  return [left, right];
}

function createRainBedState() {
  const channel = () => ({ pinkSlow: 0, pinkMid: 0, filters: new Array(6).fill(0) });
  return { left: channel(), right: channel() };
}

function renderRainBedChannel(state, white, gains) {
  state.pinkSlow = state.pinkSlow * 0.985 + white * 0.07;
  state.pinkMid = state.pinkMid * 0.88 + white * 0.22;
  const pink = white * 0.38 + state.pinkMid * 0.34 + state.pinkSlow * 0.28;
  for (let index = 0; index < RAIN_BED_ALPHAS.length; index += 1) {
    state.filters[index] += (pink - state.filters[index]) * RAIN_BED_ALPHAS[index];
  }
  const distance = state.filters[1] - state.filters[0];
  const body = state.filters[3] - state.filters[2];
  const mist = state.filters[5] - state.filters[4];
  return distance * gains.distance + body * gains.body + mist * gains.mist;
}

function renderRainBed(state, random, amount) {
  const gains = rainBedGains(amount);
  const common = random() * 2 - 1;
  const leftNoise = common * 0.72 + (random() * 2 - 1) * 0.28;
  const rightNoise = common * 0.72 + (random() * 2 - 1) * 0.28;
  return [
    renderRainBedChannel(state.left, leftNoise, gains),
    renderRainBedChannel(state.right, rightNoise, gains),
  ];
}

async function generateMp3(seconds, amount, onProgress) {
  if (!globalThis.lamejs?.Mp3Encoder) {
    throw new Error(t("encoderMissing"));
  }

  onProgress(1, t("preparingRain"));
  const encoder = new lamejs.Mp3Encoder(2, SAMPLE_RATE, MP3_BITRATE);
  const totalFrames = Math.round(seconds * SAMPLE_RATE);
  const totalBlocks = Math.ceil(totalFrames / MP3_BLOCK_SIZE);
  const mp3Chunks = [];
  const random = createRandom();
  const rainBedState = createRainBedState();
  const intensityAt = createIntensityCurve(totalFrames, amount, random);
  const activeDrops = [];
  const dropRates = createDropRates(amount);
  let nextSmallDrop = exponentialInterval(random, dropRates.small);
  let nextMediumDrop = exponentialInterval(random, dropRates.medium);
  let nextLargeDrop = exponentialInterval(random, dropRates.large);
  let nextDrip = exponentialInterval(random, dropRates.drip);

  for (let block = 0; block < totalBlocks; block += 1) {
    const startFrame = block * MP3_BLOCK_SIZE;
    const frameCount = Math.min(MP3_BLOCK_SIZE, totalFrames - startFrame);
    const leftPcm = new Int16Array(frameCount);
    const rightPcm = new Int16Array(frameCount);

    for (let local = 0; local < frameCount; local += 1) {
      const frame = startFrame + local;
      const currentIntensity = intensityAt(frame);
      const [bedLeft, bedRight] = renderRainBed(rainBedState, random, amount);

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
      while (frame >= nextDrip) {
        activeDrops.push(createDrop(random, "drip", 1));
        nextDrip += exponentialInterval(random, dropRates.drip * currentIntensity);
      }
      const [dropLeft, dropRight] = renderDrops(activeDrops, random);
      const backgroundGain = currentIntensity
        * (0.98 + Math.sin(frame / SAMPLE_RATE * 0.071) * 0.012);
      leftPcm[local] = toPcm16(bedLeft * backgroundGain + dropLeft);
      rightPcm[local] = toPcm16(bedRight * backgroundGain + dropRight);
    }

    const encoded = encoder.encodeBuffer(leftPcm, rightPcm);
    if (encoded.length) mp3Chunks.push(new Uint8Array(encoded));

    if (block % 32 === 0 || block === totalBlocks - 1) {
      const progress = Math.max(2, Math.round(((block + 1) / totalBlocks) * 100));
      onProgress(progress, t("generating", { progress }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const finalChunk = encoder.flush();
  if (finalChunk.length) mp3Chunks.push(new Uint8Array(finalChunk));
  return new Blob(mp3Chunks, { type: "audio/mpeg" });
}

function createColoredNoiseBuffer(audioContext, seconds = 8) {
  const length = Math.floor(audioContext.sampleRate * seconds);
  const buffer = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

function createContinuousRainLayer(audioContext, destination, settings) {
  const source = audioContext.createBufferSource();
  const highpass = audioContext.createBiquadFilter();
  const lowpass = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  const panner = audioContext.createStereoPanner();
  source.buffer = createColoredNoiseBuffer(audioContext, settings.duration);
  source.loop = true;
  highpass.type = "highpass";
  highpass.frequency.value = settings.lowFrequency;
  highpass.Q.value = 0.45;
  lowpass.type = "lowpass";
  lowpass.frequency.value = settings.highFrequency;
  lowpass.Q.value = 0.5;
  gain.gain.value = settings.gainValue;
  panner.pan.value = settings.pan;
  source.connect(highpass).connect(lowpass).connect(gain).connect(panner).connect(destination);
  source.start(audioContext.currentTime, Math.random() * source.buffer.duration);
  return { source, highpass, lowpass, gain, panner };
}

async function startContinuousPlayback(amount) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const audioContext = new AudioContextClass({ sampleRate: SAMPLE_RATE });
  await audioContext.resume();
  const masterGain = audioContext.createGain();
  const variationGain = audioContext.createGain();
  const now = audioContext.currentTime;
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(0.9, now + 1.2);
  variationGain.gain.setValueAtTime(1, now);
  variationGain.connect(masterGain).connect(audioContext.destination);

  const gains = rainBedGains(amount);
  const layers = [
    createContinuousRainLayer(audioContext, variationGain, {
      lowFrequency: 90, highFrequency: 1100, gainValue: gains.distance, pan: -0.08, duration: 8.3,
    }),
    createContinuousRainLayer(audioContext, variationGain, {
      lowFrequency: 650, highFrequency: 4200, gainValue: gains.body, pan: 0.06, duration: 9.7,
    }),
    createContinuousRainLayer(audioContext, variationGain, {
      lowFrequency: 3800, highFrequency: 10500, gainValue: gains.mist, pan: 0, duration: 11.1,
    }),
  ];

  continuousSession = {
    audioContext,
    masterGain,
    variationGain,
    sources: layers.map((layer) => layer.source),
    layers,
    liveDropSources: new Set(),
    dropTimer: null,
    modulationTimer: null,
    amount,
  };
  scheduleContinuousDrops(continuousSession);
  scheduleContinuousModulation(continuousSession);
}

function scheduleContinuousModulation(session) {
  if (continuousSession !== session) return;
  const now = session.audioContext.currentTime;
  const duration = 1.5 + Math.random() * 4.5;
  const gains = rainBedGains(session.amount);
  const settings = [
    { base: gains.distance, variation: 0.18 },
    { base: gains.body, variation: 0.12 },
    { base: gains.mist, variation: 0.22 },
  ];
  for (let index = 0; index < session.layers.length; index += 1) {
    const parameter = session.layers[index].gain.gain;
    const setting = settings[index];
    const variation = 1 - setting.variation + Math.random() * setting.variation * 2;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(Math.max(0.0001, parameter.value), now);
    parameter.linearRampToValueAtTime(Math.max(0.0001, setting.base * variation), now + duration);
  }
  const mistCutoff = session.layers[2].lowpass.frequency;
  mistCutoff.cancelScheduledValues(now);
  mistCutoff.setValueAtTime(mistCutoff.value, now);
  mistCutoff.linearRampToValueAtTime(8000 + Math.random() * 4000, now + duration);
  session.modulationTimer = setTimeout(() => scheduleContinuousModulation(session), duration * 1000);
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
  for (const size of ["small", "medium", "large", "drip"]) {
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
  const { audioContext, layers } = continuousSession;
  continuousSession.amount = amount;
  const now = audioContext.currentTime;
  const targetGains = rainBedGains(amount);
  const gains = [targetGains.distance, targetGains.body, targetGains.mist];
  for (let index = 0; index < layers.length; index += 1) {
    const parameter = layers[index].gain.gain;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(gains[index], now, 0.24);
  }
}

async function stopContinuousPlayback() {
  if (!continuousSession) return;
  const session = continuousSession;
  continuousSession = null;
  if (session.dropTimer) clearTimeout(session.dropTimer);
  if (session.modulationTimer) clearTimeout(session.modulationTimer);
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
  durationValue.value = seconds < 60
    ? t("seconds", { value: seconds })
    : t("minutes", {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60 ? t("seconds", { value: seconds % 60 }) : "",
    }).trim();
  buttonTime.textContent = continuousSession ? "LIVE" : continuous.checked ? "∞" : formatDuration(seconds);

  const amount = Number(intensity.value);
  const label = amount < 0.34 ? t("intensityQuiet") : amount < 0.72 ? t("intensityGentle") : t("intensitySteady");
  intensityValue.value = `${label} ${Math.round(amount * 100)}%`;
}

function updateMode() {
  if (regenerationTimer) {
    clearTimeout(regenerationTimer);
    regenerationTimer = null;
  }
  duration.disabled = continuous.checked;
  document.querySelector(".button-text").textContent = continuousSession
    ? t("stop") : continuous.checked ? t("startContinuous") : t("generate");
  buttonTime.textContent = continuous.checked ? "∞" : formatDuration(Number(duration.value));
}

duration.addEventListener("input", () => {
  updateControls();
  if (currentAudioUrl && !continuousSession) setStatus("durationChanged");
});
intensity.addEventListener("input", () => {
  updateControls();
  const amount = Number(intensity.value);
  if (continuousSession) {
    updateContinuousIntensity(amount);
    setStatus("continuousPlayingAmount", { amount: Math.round(amount * 100) });
  } else if (currentAudioUrl) {
    if (regenerationTimer) clearTimeout(regenerationTimer);
    setStatus("changingIntensity");
    regenerationTimer = setTimeout(() => {
      regenerationTimer = null;
      setStatus("regenerating");
      generateButton.click();
    }, 450);
  }
});
continuous.addEventListener("change", updateMode);
languageButtons.forEach((button) => {
  button.addEventListener("click", () => applyLocale(button.dataset.locale));
});

generateButton.addEventListener("click", async () => {
  if (regenerationTimer) {
    clearTimeout(regenerationTimer);
    regenerationTimer = null;
  }
  if (continuousSession) {
    generateButton.disabled = true;
    setStatus("stopping");
    await stopContinuousPlayback();
    trackEvent("continuous_playback_stop");
    generateButton.disabled = false;
    continuous.disabled = false;
    intensity.disabled = false;
    document.querySelector(".button-text").textContent = t("startContinuous");
    setStatus("stopped");
    return;
  }

  generateButton.disabled = true;
  duration.disabled = true;
  intensity.disabled = true;
  continuous.disabled = true;
  setStatus(continuous.checked ? "preparingContinuous" : "preparingRain");
  status.classList.add("busy");
  try {
    if (continuous.checked) {
      await startContinuousPlayback(Number(intensity.value));
      trackEvent("continuous_playback_start", {
        intensity: Number(intensity.value),
      });
      player.pause();
      setStatus("continuousPlaying");
      document.querySelector(".button-text").textContent = t("stop");
      buttonTime.textContent = "LIVE";
      generateButton.disabled = false;
      intensity.disabled = false;
      return;
    }

    const seconds = Number(duration.value);
    const audio = await generateMp3(seconds, Number(intensity.value), (progress) => {
      setStatus(progress <= 1 ? "preparingRain" : "generating", { progress });
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
    setStatus("complete");
    playerPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    await player.play().catch(() => {});
  } catch (error) {
    if (error instanceof Error) {
      statusKey = "genericError";
      statusParameters = {};
      status.textContent = error.message;
    } else {
      setStatus("genericError");
    }
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

applyLocale(locale);
