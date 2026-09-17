export class BrowserAudioEngine {
  constructor({ onAudioChunk, onLevel, onOutputStarted, onOutputDrained } = {}) {
    this.onAudioChunk = onAudioChunk;
    this.onLevel = onLevel;
    this.onOutputStarted = onOutputStarted;
    this.onOutputDrained = onOutputDrained;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.activeSources = new Set();
    this.nextPlayTime = 0;
    this.running = false;
    this.muted = false;
    this.startGeneration = 0;
  }

  async start({ captureMicrophone = true } = {}) {
    if (this.running) return;
    if (captureMicrophone && !navigator.mediaDevices?.getUserMedia) throw new Error("此瀏覽器不支援麥克風擷取。");
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("此瀏覽器不支援 Web Audio API。");

    const generation = ++this.startGeneration;
    const context = new AudioContextClass({ latencyHint: "interactive" });
    this.context = context;
    const assertCurrent = () => {
      if (generation !== this.startGeneration) throw new DOMException("Audio start cancelled", "AbortError");
    };
    await context.resume();
    assertCurrent();
    this.outputGain = this.context.createGain();
    this.outputGain.gain.value = 0.92;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.outputGain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    if (captureMicrophone) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        assertCurrent();
      }
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(this.stream);
      await this.context.audioWorklet.addModule(new URL("./audio-capture-worklet.js", import.meta.url));
      assertCurrent();
      this.processor = new AudioWorkletNode(this.context, "pageask-audio-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
      });
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.processor.port.onmessage = (event) => this.capture(event.data);
      this.source.connect(this.processor);
      this.processor.connect(this.silentGain);
      this.silentGain.connect(this.context.destination);
    }
    this.nextPlayTime = this.context.currentTime;
    this.running = true;
  }

  capture(floatSamples) {
    if (!this.running || !this.context || this.muted) return;
    const pcm = floatToPcm16(resample(floatSamples, this.context.sampleRate, 16000));
    this.onAudioChunk?.(pcm);
    if (this.onLevel) {
      let sum = 0;
      for (const sample of floatSamples) sum += sample * sample;
      this.onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, floatSamples.length)) * 3.5));
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this.onLevel?.(0);
  }

  playPcm24k(bytes) {
    if (!this.context || !bytes?.byteLength) return;
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const buffer = this.context.createBuffer(1, sampleCount, 24000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputGain || this.context.destination);
    const startAt = Math.max(this.context.currentTime + 0.015, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.activeSources.add(source);
    this.onOutputStarted?.();
    source.onended = () => {
      this.activeSources.delete(source);
      if (!this.activeSources.size) this.onOutputDrained?.();
    };
  }

  flushPlayback() {
    const wasPlaying = this.activeSources.size > 0;
    for (const source of this.activeSources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    this.activeSources.clear();
    if (this.context) this.nextPlayTime = this.context.currentTime;
    if (wasPlaying) this.onOutputDrained?.();
  }

  async stop() {
    ++this.startGeneration;
    this.running = false;
    this.flushPlayback();
    if (this.processor) {
      this.processor.port.onmessage = null;
      try { this.processor.disconnect(); } catch { /* Already disconnected. */ }
    }
    try { this.source?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.silentGain?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.outputGain?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.analyser?.disconnect(); } catch { /* Already disconnected. */ }
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.onLevel?.(0);
    if (context && context.state !== "closed") await context.close();
  }

  isPlaying() {
    return Boolean(this.context && this.activeSources.size && this.nextPlayTime > this.context.currentTime + 0.018);
  }

  getAnalyser() { return this.analyser; }
}

export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
    output[index] = sum / (end - start);
  }
  return output;
}

export function floatToPcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}
