export const AVATAR_GESTURES = Object.freeze([
  "nod", "shake_head", "wave", "present", "tilt_head",
  "bow", "shrug", "hand_on_chest", "beckon", "salute",
]);

export const AVATAR_GESTURE_TOOL = Object.freeze({
  name: "play_avatar_gesture",
  behavior: "NON_BLOCKING",
  description: "依照即將說出的內容選擇一個自然動作。每個回覆最多呼叫一次，沒有適合情境就不呼叫。",
  parameters: {
    type: "OBJECT",
    properties: { gesture: { type: "STRING", enum: [...AVATAR_GESTURES] } },
    required: ["gesture"],
  },
});

export function normalizeAvatarGesture(args) {
  const gesture = args && typeof args === "object" && !Array.isArray(args) ? args.gesture : undefined;
  if (!AVATAR_GESTURES.includes(gesture)) {
    return { ok: false, error: `請使用支援的 gesture：${AVATAR_GESTURES.join("、")}。` };
  }
  return { ok: true, gesture };
}

const DURATIONS = {
  nod: 1.5, shake_head: 1.6, wave: 2.4, present: 2.6, tilt_head: 1.8,
  bow: 1.9, shrug: 1.6, hand_on_chest: 2.2, beckon: 2.4, salute: 1.9,
};

const smooth = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

function sampleGesture(name, time) {
  const duration = DURATIONS[name];
  const weight = smooth(time / 0.35) * smooth((duration - time) / 0.45);
  const beat = Math.sin(time * Math.PI * 3);
  const offer = smooth((time - 0.35) / 0.65) * (1 - smooth((time - 1.65) / 0.45));
  switch (name) {
    case "nod": return { head: [0.16 * beat * weight, 0, 0], neck: [0.04 * beat * weight, 0, 0] };
    case "shake_head": return { head: [0, 0.21 * beat * weight, 0], neck: [0, 0.05 * beat * weight, 0] };
    case "tilt_head": return { head: [0, -0.06 * weight, -0.16 * weight], neck: [0, 0, -0.04 * weight] };
    case "bow": return { spine: [-0.16 * weight, 0, 0], chest: [-0.22 * weight, 0, 0], neck: [-0.08 * weight, 0, 0], head: [-0.12 * weight, 0, 0] };
    case "shrug": return {
      leftShoulder: [0, 0, -0.18 * weight], rightShoulder: [0, 0, 0.18 * weight],
      leftUpperArm: [0.15 * weight, 0.21 * weight, 0.25 * weight], rightUpperArm: [0.15 * weight, -0.21 * weight, -0.25 * weight],
      leftLowerArm: [0, -2.15 * weight, 0], rightLowerArm: [0, 2.15 * weight, 0],
      leftHand: [1.7 * weight, -0.19 * weight, -0.19 * weight], rightHand: [1.7 * weight, 0.19 * weight, 0.19 * weight],
      head: [-0.03 * weight, 0, 0],
    };
    case "hand_on_chest": return { rightUpperArm: [-0.38 * weight, 0.31 * weight, 0.13 * weight], rightLowerArm: [0, 1.94 * weight, 0], rightHand: [0.83 * weight, -0.11 * weight, -0.88 * weight] };
    case "beckon": {
      const curl = 0.5 - 0.5 * Math.cos(Math.max(0, time - 0.4) * Math.PI * 3);
      const pose = {
        rightUpperArm: [0.2 * weight, 0, -0.09 * weight],
        rightLowerArm: [0, (2.1 + 0.08 * curl) * weight, 0],
        rightHand: [1.82 * weight, -0.06 * weight, 0.19 * weight],
      };
      for (const finger of ["Index", "Middle", "Ring", "Little"]) {
        pose[`right${finger}Proximal`] = [0, 0, -(0.1 + 0.85 * curl) * weight];
        pose[`right${finger}Intermediate`] = [0, 0, -(0.1 + 0.95 * curl) * weight];
        pose[`right${finger}Distal`] = [0, 0, -(0.05 + 0.5 * curl) * weight];
      }
      return pose;
    }
    case "salute": {
      const lift = smooth((time - 0.1) / 0.4) * smooth((duration - time) / 0.45);
      const bend = smooth(time / 0.24) * smooth((duration - time) / 0.24);
      return {
        rightUpperArm: [1.56 * lift, 1.13 * lift, -0.89 * lift], rightLowerArm: [0, 2.15 * bend, 0],
        rightHand: [0.56 * weight, -0.32 * weight, -1.08 * weight], rightIndexProximal: [0, -0.12 * weight, 0],
        rightRingProximal: [0, 0.1 * weight, 0], rightLittleProximal: [0, 0.22 * weight, 0], rightThumbMetacarpal: [0, -0.45 * weight, -0.15 * weight],
      };
    }
    case "wave": return { rightUpperArm: [0, 0, -0.08 * weight], rightLowerArm: [0, 2.7 * weight, (0.2 + 0.1 * beat) * weight], rightHand: [-1.51 * weight, -0.28 * weight, 0.36 * weight] };
    case "present": return { rightUpperArm: [0.63 * weight, 0.25 * weight, -0.28 * weight], rightLowerArm: [0, 1.4 * weight, (-0.55 + 0.3 * offer) * weight], rightHand: [1.42 * weight, 0.86 * weight, 0.33 * weight] };
    default: return {};
  }
}

export class AvatarGesturePlayer {
  constructor() {
    this.pending = null;
    this.active = null;
  }

  queue(gesture) {
    if (!AVATAR_GESTURES.includes(gesture) || this.pending || this.active) return false;
    this.pending = { gesture, wait: 0, finished: false };
    return true;
  }

  finishTurn() { if (this.pending) this.pending.finished = true; }

  reset(immediate = false) {
    this.pending = null;
    if (immediate) this.active = null;
    else if (this.active && this.active.release === undefined) this.active.release = 0;
  }

  update(deltaTime, playing) {
    if (this.pending) {
      this.pending.wait += deltaTime;
      if (this.pending.wait > 8 || (this.pending.finished && !playing)) this.pending = null;
      else if (playing) { this.active = { gesture: this.pending.gesture, time: 0 }; this.pending = null; }
    }
    if (!this.active) return {};
    const active = this.active;
    if (!playing && active.release === undefined) active.release = 0;
    if (active.release !== undefined) active.release += deltaTime;
    else active.time += deltaTime;
    if (active.time >= DURATIONS[active.gesture] || (active.release ?? 0) >= 0.25) { this.active = null; return {}; }
    const pose = sampleGesture(active.gesture, active.time);
    const fade = active.release === undefined ? 1 : 1 - smooth(active.release / 0.25);
    for (const angles of Object.values(pose)) for (let index = 0; index < 3; index += 1) angles[index] *= fade;
    return pose;
  }
}
