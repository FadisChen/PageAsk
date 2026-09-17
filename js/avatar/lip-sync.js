export class LipSyncAnalyzer {
  constructor(analyser) {
    this.analyser = analyser;
    this.frequencyData = new Uint8Array(analyser?.frequencyBinCount || 0);
    this.timeData = new Uint8Array(analyser?.fftSize || 0);
    this.currentWeight = 0;
    this.currentViseme = "none";
  }

  reset() { this.currentWeight = 0; this.currentViseme = "none"; }

  update(playing = true) {
    if (!playing || !this.analyser) { this.reset(); return { viseme: "none", weight: 0, rms: 0 }; }
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (const sample of this.timeData) { const value = (sample - 128) / 128; sum += value * value; }
    const rms = Math.sqrt(sum / Math.max(1, this.timeData.length));
    const low = this.average(2, 11);
    const mid = this.average(11, 34);
    const high = this.average(34, 105);
    const active = rms > 0.012;
    const viseme = active ? classifyViseme(low, mid, high) : "none";
    const target = active ? Math.min(1, Math.max(0, (rms - 0.012) * 4.6)) : 0;
    this.currentWeight += (target - this.currentWeight) * (target > this.currentWeight ? 0.38 : 0.18);
    if (this.currentWeight < 0.012) { this.currentWeight = 0; this.currentViseme = "none"; }
    else this.currentViseme = viseme;
    return { viseme: this.currentViseme, weight: this.currentWeight, rms };
  }

  average(start, end) {
    const lower = Math.min(start, this.frequencyData.length);
    const upper = Math.min(end, this.frequencyData.length);
    if (upper <= lower) return 0;
    let sum = 0;
    for (let index = lower; index < upper; index += 1) sum += this.frequencyData[index] / 255;
    return sum / (upper - lower);
  }
}

function classifyViseme(low, mid, high) {
  if (low > mid * 1.16 && low > high * 1.12) return "aa";
  if (high > low * 1.22 && high > mid * 1.06) return "ih";
  if (mid > low * 1.16 && mid > high * 1.08) return "ou";
  if (high >= mid) return "ee";
  return "oh";
}
