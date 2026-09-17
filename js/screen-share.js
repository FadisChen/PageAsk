const FRAME_INTERVAL_MS = 1000;
const MAX_FRAME_EDGE = 1024;
const JPEG_QUALITY = 0.7;

export class ScreenShare {
  constructor({ onFrame, onEnded } = {}) {
    this.onFrame = onFrame;
    this.onEnded = onEnded;
    this.stream = null;
    this.video = null;
    this.timer = null;
    this.capturing = false;
  }

  get active() { return Boolean(this.stream); }

  async start() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("此瀏覽器不支援畫面分享。");
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    const [track] = stream.getVideoTracks();
    track?.addEventListener("ended", () => {
      if (this.stream !== stream) return;
      this.stop();
      this.onEnded?.();
    }, { once: true });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.stream = stream;
    this.video = video;
    await video.play();
    if (this.stream !== stream) return;
    void this.captureFrame();
    this.timer = setInterval(() => void this.captureFrame(), FRAME_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }

  async captureFrame() {
    const { video } = this;
    if (this.capturing || !video?.videoWidth || !video.videoHeight) return;
    this.capturing = true;
    try {
      const { width, height } = fitFrame(video.videoWidth, video.videoHeight, MAX_FRAME_EDGE);
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d").drawImage(video, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
      if (this.video === video) this.onFrame?.(new Uint8Array(await blob.arrayBuffer()));
    } finally {
      this.capturing = false;
    }
  }
}

export function fitFrame(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
