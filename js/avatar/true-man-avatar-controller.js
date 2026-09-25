const DEFAULT_STATE = "idle";
const EMOTION_CROSSFADE_SECONDS = 0.55;
const VISEME_CROSSFADE_SECONDS = 0.06;
const DOUBLE_BLINK_CHANCE = 0.15;
const HALF_BLINK_CHANCE = 0.18;
const BROW_LIFT_WEIGHT = 0.28;
const BLINK_INTERVALS = { idle: [2, 6], listening: [3, 7], thinking: [2.5, 6], speaking: [2, 5] };
// Eyes jump between gaze photos with a hard cut, like a real saccade; any
// partial blend of two photos with different gaze shows two irises.
const STRONG_GAZES = new Set(["left", "right", "up"]);
// Per state: how long the eyes rest on centre, how long they stay away, and where they go.
const GAZE_PATTERNS = {
  idle: { center: [1.5, 4], away: [0.5, 1.4], targets: ["left-soft", "right-soft", "left-soft", "right-soft", "left", "right"] },
  listening: { center: [2.5, 5.5], away: [0.3, 0.8], targets: ["left-soft", "right-soft"] },
  speaking: { center: [1.2, 3.2], away: [0.4, 1.2], targets: ["left-soft", "right-soft", "left-soft", "right-soft", "left", "right", "up"] },
  thinking: { center: [0.3, 0.7], away: [1.4, 3], targets: ["up", "left", "right", "up"] },
};

// Head motion for a single frontal photograph: pixel nods and radian leans
// around the chest pivot. Hand gestures fall back to a small nod and lean.
const GESTURE_MOTIONS = {
  nod: { duration: 1.3, motion: (t, env) => ({ nod: 4.5 * env * (0.5 - 0.5 * Math.cos(Math.PI * 4 * t)), lean: 0 }) },
  listen_nod: { duration: 0.9, motion: (t, env) => ({ nod: 2.5 * env * env, lean: 0 }) },
  shake_head: { duration: 1.4, motion: (t, env) => ({ nod: 0, lean: 0.007 * env * Math.sin(Math.PI * 6 * t) }) },
  tilt_head: { duration: 1.8, motion: (t, env) => ({ nod: 0.8 * env, lean: 0.011 * Math.min(1, env * 1.6) }) },
  bow: { duration: 1.9, motion: (t, env) => ({ nod: 8 * env, lean: 0 }) },
};
const DEFAULT_GESTURE_MOTION = { duration: 1.6, motion: (t, env) => ({ nod: 3 * env, lean: 0.004 * env }) };

export function getGestureMotion(name, time) {
  const { duration, motion } = GESTURE_MOTIONS[name] || DEFAULT_GESTURE_MOTION;
  if (time < 0 || time >= duration) return { nod: 0, lean: 0, done: time >= duration };
  const t = time / duration;
  return { ...motion(t, Math.sin(Math.PI * t)), done: false };
}

// A short rise then exponential fall, like an eyebrow flash on a stressed syllable.
export function getBrowLift(time) {
  if (time < 0) return 0;
  if (time < 0.08) return easeInOutSine(time / 0.08);
  return Math.exp(-(time - 0.08) / 0.3);
}

export function easeInOutSine(value) {
  const progress = clamp(value, 0, 1);
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

export function crossfadeWeights(progress, weight = 1) {
  const current = easeInOutSine(progress) * clamp(weight, 0, 1);
  return { previous: clamp(weight, 0, 1) - current, current };
}

export function getBreathTransform(phase, reducedMotion = false) {
  if (reducedMotion) return { translateY: 0, scaleX: 1, scaleY: 1 };
  const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  // Shorter inhale, longer exhale; zero velocity at both turning points.
  const expansion = cycle < 0.38 ? easeInOutSine(cycle / 0.38) : 1 - easeInOutSine((cycle - 0.38) / 0.62);
  return { translateY: expansion * 5, scaleX: 1 + expansion * 0.012, scaleY: 1 + expansion * 0.012 };
}

export class TrueManAvatarController {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.context = canvas.getContext("2d", { alpha: true });
    this.manifest = null;
    this.images = { base: null, blink: null, visemes: new Map(), emotions: new Map(), gaze: new Map() };
    this.loaded = false;
    this.state = DEFAULT_STATE;
    this.emotion = "neutral";
    this.emotionMix = 1;
    this.emotionWeights = { neutral: 1 };
    this.emotionStartWeights = { neutral: 1 };
    this.emotionHoldUntil = 0;
    this.emotionReleaseAt = null;
    this.viseme = "none";
    this.visemeMix = 1;
    this.visemeWeights = { aa: 1 };
    this.visemeStartWeights = { aa: 1 };
    this.targetMouthWeight = 0;
    this.mouthWeight = 0;
    this.blinkProgress = 0;
    this.blinkDirection = 0;
    this.blinkTimer = randomBetween(2, 6);
    this.blinkDepth = 1;
    this.blinkCloseSeconds = 0.075;
    this.blinkOpenSeconds = 0.13;
    this.pendingDoubleBlink = false;
    this.elapsed = 0;
    this.outputLevel = 0;
    this.levelAverage = 0;
    this.speechPresence = 0;
    this.thinkingPose = 0;
    this.gesture = null;
    this.nextListenNodAt = 0;
    this.browStartedAt = -Infinity;
    this.browCooldownUntil = 0;
    this.grainPattern = null;
    this.gaze = "center";
    this.nextGazeAt = randomBetween(1, 3);
    this.reducedMotion = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    this.resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.motionMedia = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.motionListener = () => { this.reducedMotion = Boolean(this.motionMedia?.matches); };
    this.motionMedia?.addEventListener?.("change", this.motionListener);
    this.resize();
  }

  async load(manifestSource) {
    const token = (this.loadToken || 0) + 1;
    this.loadToken = token;
    this.loaded = false;
    this.callbacks.onLoading?.(0);
    try {
      let manifest = manifestSource;
      let manifestBaseUrl = "";
      if (typeof manifestSource === "string") {
        const response = await fetch(manifestSource, { cache: "no-store" });
        if (!response.ok) throw new Error(`角色 manifest 載入失敗（${response.status}）。`);
        manifest = await response.json();
        manifestBaseUrl = manifestSource;
      }
      if (!manifest || typeof manifest !== "object") throw new Error("角色 manifest 格式無效。");
      const resolveAsset = (source) => manifestBaseUrl ? new URL(source, manifestBaseUrl).href : source;
      this.manifest = manifest;
      const base = await loadImage(resolveAsset(manifest.base));
      this.callbacks.onLoading?.(0.1);
      const variantEntries = [
        ["blink", manifest.blink],
        ...Object.entries(manifest.visemes || {}).map(([name, src]) => [`viseme:${name}`, src]),
        ...Object.entries(manifest.emotions || {}).filter(([name]) => name !== "neutral").map(([name, src]) => [`emotion:${name}`, src]),
        ...Object.entries(manifest.gaze || {}).map(([name, src]) => [`gaze:${name}`, src]),
      ].filter(([, src]) => src);
      const variants = await Promise.all(variantEntries.map(async ([name, src]) => [name, await loadImage(resolveAsset(src))]));
      if (token !== this.loadToken) return false;
      this.images.base = base;
      this.images.blink = variants.find(([name]) => name === "blink")?.[1] || null;
      this.images.visemes = new Map(variants.filter(([name]) => name.startsWith("viseme:")).map(([name, image]) => [name.slice(7), image]));
      this.images.emotions = new Map(variants.filter(([name]) => name.startsWith("emotion:")).map(([name, image]) => [name.slice(8), image]));
      this.images.gaze = new Map(variants.filter(([name]) => name.startsWith("gaze:")).map(([name, image]) => [name.slice(5), image]));
      this.loaded = true;
      this.resize();
      this.render();
      this.callbacks.onLoading?.(1);
      this.callbacks.onReady?.({ canvas: manifest.canvas });
      return true;
    } catch (error) {
      if (token === this.loadToken) this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
  setState(state) {
    const next = state || DEFAULT_STATE;
    if (next === this.state) return;
    this.state = next;
    if (next === "thinking") { this.triggerBlink(); this.nextGazeAt = this.elapsed + randomBetween(0.15, 0.4); }
    if (next === "listening") this.nextListenNodAt = this.elapsed + randomBetween(2, 5);
  }

  setEmotion(emotion, { immediate = false } = {}) {
    if (!this.manifest || !(emotion in (this.manifest.emotions || {})) && emotion !== "neutral") return;
    if (emotion === "neutral" && !immediate && this.elapsed < this.emotionHoldUntil) {
      this.emotionReleaseAt = this.emotionHoldUntil;
      return;
    }
    this.emotionHoldUntil = emotion === "neutral" ? 0 : this.elapsed + 3.5;
    this.emotionReleaseAt = null;
    if (emotion === this.emotion) return;
    if (!immediate) this.triggerBlink();
    // Emotion photos look at the viewer; blending them with averted eyes would ghost.
    this.setGaze("center");
    this.emotionStartWeights = { ...this.emotionWeights };
    this.emotion = emotion;
    this.emotionMix = 0;
  }

  setViseme(viseme, weight = 0, rms = 0) {
    const nextViseme = viseme && this.images.visemes.has(viseme) ? viseme : "none";
    // Silence closes the current shape rather than dissolving it into another mouth.
    if (nextViseme !== "none" && nextViseme !== this.viseme) {
      this.visemeStartWeights = { ...this.visemeWeights };
      this.viseme = nextViseme;
      this.visemeMix = 0;
    }
    this.targetMouthWeight = nextViseme === "none" ? 0 : clamp(weight, 0, 1);
    this.outputLevel = clamp(Number(rms) * 3.5, 0, 1);
  }

  playGesture(name) {
    if (this.reducedMotion) return;
    this.gesture = { name, time: 0 };
  }

  finishTurn() { this.triggerBlink(); }
  resetAnimation() { this.reset(); }

  // Blinks cluster around cognitive events (turn start, new emotion, thinking).
  triggerBlink() {
    if (this.blinkDirection === 0) this.blinkTimer = Math.min(this.blinkTimer, randomBetween(0.03, 0.18));
  }

  update(deltaTime, isSpeaking = false) {
    this.elapsed += deltaTime;
    this.thinkingPose += ((this.state === "thinking" ? 1 : 0) - this.thinkingPose) * (1 - Math.exp(-deltaTime * 3));
    if (!this.reducedMotion) this.updateHeadMotion(deltaTime, isSpeaking);
    this.updateGaze(isSpeaking);
    if (this.emotionReleaseAt !== null) {
      if (isSpeaking) this.emotionReleaseAt = Math.max(this.emotionReleaseAt, this.elapsed + 1.8);
      else if (this.elapsed >= this.emotionReleaseAt) this.setEmotion("neutral", { immediate: true });
    }
    const presenceTarget = isSpeaking ? clamp(this.targetMouthWeight / 0.2, 0, 1) : 0;
    this.speechPresence = this.reducedMotion ? 0 : this.speechPresence +
      (presenceTarget - this.speechPresence) * (1 - Math.exp(-deltaTime * 2.5));
    const attack = 1 - Math.exp(-deltaTime * 45);
    const release = 1 - Math.exp(-deltaTime * (this.targetMouthWeight === 0 ? 65 : 40));
    const factor = this.targetMouthWeight > this.mouthWeight ? attack : release;
    this.mouthWeight += (this.targetMouthWeight - this.mouthWeight) * factor;
    if (this.mouthWeight < 0.01) this.mouthWeight = 0;
    if (this.visemeMix < 1) this.visemeMix = Math.min(1, this.visemeMix + deltaTime / VISEME_CROSSFADE_SECONDS);
    if (this.emotionMix < 1) this.emotionMix = Math.min(1, this.emotionMix + deltaTime / EMOTION_CROSSFADE_SECONDS);
    this.emotionWeights = blendWeights(this.emotionStartWeights, this.emotion, easeInOutSine(this.emotionMix));
    if (this.viseme !== "none") this.visemeWeights = blendWeights(this.visemeStartWeights, this.viseme, easeInOutSine(this.visemeMix));
    if (!this.reducedMotion) this.updateBlink(deltaTime);
    else this.blinkProgress = 0;
    this.render();
  }

  updateHeadMotion(deltaTime, isSpeaking) {
    if (this.gesture) {
      this.gesture.time += deltaTime;
      if (getGestureMotion(this.gesture.name, this.gesture.time).done) this.gesture = null;
    }
    if (this.state === "listening" && !isSpeaking && !this.gesture && this.elapsed >= this.nextListenNodAt) {
      this.gesture = { name: "listen_nod", time: 0 };
      this.nextListenNodAt = this.elapsed + randomBetween(4, 9);
    }
    // Brow flash on emphasis: a level jump well above the recent speaking average.
    const level = isSpeaking ? this.outputLevel : 0;
    if (isSpeaking && level > 0.3 && level > this.levelAverage * 1.5 && this.elapsed >= this.browCooldownUntil) {
      this.browStartedAt = this.elapsed;
      this.browCooldownUntil = this.elapsed + randomBetween(0.9, 1.8);
    }
    this.levelAverage += (level - this.levelAverage) * (1 - Math.exp(-deltaTime * 1.5));
  }

  updateGaze(isSpeaking) {
    if (this.reducedMotion || this.emotion !== "neutral" || this.emotionMix < 1) { this.setGaze("center"); return; }
    if (this.elapsed < this.nextGazeAt || !this.images.gaze.size) return;
    const pattern = GAZE_PATTERNS[isSpeaking ? "speaking" : this.state] || GAZE_PATTERNS.idle;
    const targets = pattern.targets.filter((name) => this.images.gaze.has(name));
    const goAway = this.gaze === "center" && targets.length;
    this.setGaze(goAway ? targets[Math.floor(Math.random() * targets.length)] : "center");
    const [min, max] = goAway ? pattern.away : pattern.center;
    this.nextGazeAt = this.elapsed + randomBetween(min, max);
  }

  setGaze(gaze) {
    if (gaze === this.gaze) return;
    // Large saccades are often accompanied by a blink.
    if ((STRONG_GAZES.has(gaze) || STRONG_GAZES.has(this.gaze)) && Math.random() < 0.4) this.triggerBlink();
    this.gaze = gaze;
  }

  gazeImage(gaze) {
    return this.images.gaze.get(gaze) || this.images.base;
  }

  updateBlink(deltaTime) {
    this.blinkTimer -= deltaTime;
    if (this.blinkDirection === 0 && this.blinkTimer <= 0) {
      this.blinkDirection = 1;
      this.blinkCloseSeconds = randomBetween(0.06, 0.09);
      this.blinkOpenSeconds = randomBetween(0.1, 0.17);
      const isSecondBlink = this.pendingDoubleBlink;
      this.pendingDoubleBlink = !isSecondBlink && Math.random() < DOUBLE_BLINK_CHANCE;
      // Half blinks stay within the open-eye warp and never show the closed-lid texture.
      this.blinkDepth = !isSecondBlink && !this.pendingDoubleBlink && Math.random() < HALF_BLINK_CHANCE ? randomBetween(0.45, 0.6) : 1;
    }
    if (this.blinkDirection === 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + deltaTime / this.blinkCloseSeconds);
      if (this.blinkProgress >= 1) this.blinkDirection = -1;
    } else if (this.blinkDirection === -1) {
      this.blinkProgress = Math.max(0, this.blinkProgress - deltaTime / this.blinkOpenSeconds);
      if (this.blinkProgress <= 0) {
        this.blinkDirection = 0;
        const [min, max] = BLINK_INTERVALS[this.state] || BLINK_INTERVALS.idle;
        this.blinkTimer = this.pendingDoubleBlink ? randomBetween(0.12, 0.25) : randomBetween(min, max);
      }
    }
  }

  resize() {
    if (!this.context || !this.manifest) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || 500);
    const cssHeight = Math.max(1, rect.height || 600);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.render();
  }

  render() {
    if (!this.context || !this.manifest) return;
    const { width, height } = this.canvas;
    const designWidth = this.manifest.canvas.width;
    const designHeight = this.manifest.canvas.height;
    const scale = Math.min(width / designWidth, height / designHeight);
    const offsetX = (width - designWidth * scale) / 2;
    const offsetY = (height - designHeight * scale) / 2;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, width, height);
    if (!this.images.base) return;
    this.context.save();
    this.context.translate(offsetX, offsetY);
    this.context.scale(scale, scale);
    // A shared shoulder-pivot transform moves the head, hair and every facial
    // patch together. Keep it small enough for a single frontal photograph.
    const gesture = this.gesture ? getGestureMotion(this.gesture.name, this.gesture.time) : { lean: 0, nod: 0 };
    const presence = this.reducedMotion ? { lean: 0, nod: 0 } : {
      lean: Math.sin(this.elapsed * 0.47) * 0.004 + Math.sin(this.elapsed * 0.83) * 0.002 +
        Math.sin(this.elapsed * 1.17) * this.speechPresence * 0.003 + this.thinkingPose * 0.005 + gesture.lean,
      nod: this.speechPresence * 3.5 * Math.sin(this.elapsed * 2.1) * Math.sin(this.elapsed * 0.63) + gesture.nod,
    };
    const pivotY = this.manifest.rig?.breath?.chestY || designHeight * 0.74;
    this.context.translate(designWidth / 2, pivotY + presence.nod);
    this.context.rotate(presence.lean);
    this.context.translate(-designWidth / 2, -pivotY);
    const breath = getBreathTransform(this.elapsed * 1.32, this.reducedMotion);
    // Draw the portrait once. Fractional strip edges on translucent hair caused
    // horizontal seams; a shared continuous transform has no internal edges.
    this.context.translate(designWidth / 2, designHeight);
    this.context.scale(1 + (breath.scaleX - 1) * 0.6, 1 + (breath.scaleY - 1) * 0.7);
    this.context.translate(-designWidth / 2, -designHeight);
    this.context.drawImage(this.images.base, 0, 0, designWidth, designHeight);

    const emotionRegion = this.manifest.regions.emotion || this.manifest.regions.face;
    const expressions = Object.entries(this.emotionWeights).map(([name, weight]) => ({
      name, image: name === "neutral" ? this.images.base : this.images.emotions.get(name), weight,
    }));
    // The surprised photo looks at the viewer, so only flash brows on a centred gaze.
    const browLift = this.reducedMotion || this.gaze !== "center" || !this.images.emotions.has("surprised") ? 0 :
      getBrowLift(this.elapsed - this.browStartedAt) * BROW_LIFT_WEIGHT;
    // Gaze photos only replace the neutral eyes; an emotion photo keeps its own eyes.
    const eyeExpressions = expressions.map((entry) => ({
      ...entry, image: entry.name === "neutral" ? this.gazeImage(this.gaze) : entry.image, weight: entry.weight * (1 - browLift),
    }));
    if (browLift > 0.005) eyeExpressions.push({ image: this.images.emotions.get("surprised"), weight: browLift });
    if (emotionRegion) this.drawFeature(eyeExpressions, emotionRegion);
    const mouthRegion = this.manifest.regions.mouth;
    const rig = this.manifest.rig;
    if (mouthRegion && rig?.mouth) {
      // Emotion mouths such as a wide smile sit elsewhere; morph lips between
      // their anchors instead of dissolving, which would show two lip lines.
      const mouthExpressions = expressions.map((entry) => ({
        ...entry,
        bounds: rig.emotionMouth?.[entry.name]?.inner || rig.mouth.neutral,
        outer: rig.emotionMouth?.[entry.name]?.outer || rig.mouthOuter.neutral,
      }));
      const blendAnchors = (key) => rig.mouth.neutral.map((_, index) =>
        mouthExpressions.reduce((sum, entry) => sum + entry[key][index] * entry.weight, 0));
      const rest = blendAnchors("bounds");
      const restOuter = blendAnchors("outer");
      if (this.mouthWeight > 0) {
        // Use the open /o/ photo for rounded vowels; the /u/ photo itself is
        // strongly pursed. Distinguish /u/ with a smaller aperture, not thicker lips.
        const relaxedWeights = {};
        const roundAmount = easeInOutSine(clamp((this.mouthWeight - 0.05) / 0.12, 0, 1));
        const roundO = (this.visemeWeights.oh || 0) * roundAmount;
        const roundU = (this.visemeWeights.ou || 0) * roundAmount;
        for (const [name, weight] of Object.entries(this.visemeWeights)) {
          const rounded = name === "oh" || name === "ou";
          if (rounded) {
            relaxedWeights.aa = (relaxedWeights.aa || 0) + weight * (1 - roundAmount);
            relaxedWeights.oh = (relaxedWeights.oh || 0) + weight * roundAmount;
          } else relaxedWeights[name] = (relaxedWeights[name] || 0) + weight;
        }
        const MOUTH_WIDTH_SCALE = 0.95;
        const sources = Object.entries(relaxedWeights).filter(([name]) => this.images.visemes.has(name));
        const full = rest.map((_, index) => sources.reduce((sum, [name, weight]) => sum + rig.mouth[name][index] * weight, 0));
        // Audio level is not a geometric percentage: quiet speech still needs a
        // readable jaw opening. Lip thickness/rounding stay independently bounded.
        const opening = Math.min(Math.sqrt(this.mouthWeight) * 1.15, 0.68);
        const articulation = easeInOutSine(Math.min(1, this.mouthWeight / 0.045));
        const centerX = (rest[0] + rest[2]) / 2;
        const target = rest.map((value, index) => index % 2 === 0 ?
          centerX + (value - centerX) *  MOUTH_WIDTH_SCALE *(1 - roundO * 0.32 - roundU * 0.44) :
          value + (full[index] - value) * opening);
        // The rounded apertures remain visible: /o/ is taller/wider, /u/ smaller.
        const nativeGap = target[3] - target[1];
        target[3] = target[1] + nativeGap * (1 - roundO - roundU) +
          (4 + opening * 42) * roundO + (4 + opening * 30) * roundU;
        const targetOuter = [
          centerX + (restOuter[0] - centerX) *  MOUTH_WIDTH_SCALE * (1 - roundO * 0.14 - roundU * 0.2),
          target[1] - (rest[1] - restOuter[1]) * (1 - 0.12 * articulation),
          centerX + (restOuter[2] - centerX) * (1 - roundO * 0.14 - roundU * 0.2),
          target[3] + (restOuter[3] - rest[3]) * (1 - 0.18 * articulation),
        ];
        // Align lip contours BEFORE blending textures. Volume changes geometry,
        // never the opacity of an open mouth laid over the closed base photograph.
        const textureMix = articulation;
        this.drawFeature([
          ...mouthExpressions.map((entry) => ({ ...entry, weight: entry.weight * (1 - textureMix) })),
          ...sources.map(([name, weight]) => ({ image: this.images.visemes.get(name), weight: weight * textureMix, bounds: rig.mouth[name], outer: rig.mouthOuter[name] })),
        ], mouthRegion, target, targetOuter);
      } else this.drawFeature(mouthExpressions, mouthRegion, rest, restOuter);
    } else if (mouthRegion) this.drawFeature(expressions, mouthRegion);
    if (rig?.eyes && this.images.blink && this.blinkProgress > 0) {
      const closure = easeInOutSine(this.blinkProgress) * this.blinkDepth;
      for (const eye of rig.eyes) {
        const target = eye.open.map((value, index) => value + (eye.closed[index] - value) * closure);
        // Keep the iris opaque while the lid moves, then reveal the closed-lid texture.
        const closedMix = easeInOutSine(clamp((closure - 0.65) / 0.35, 0, 1));
        this.drawFeature([
          ...eyeExpressions.map((entry) => ({ ...entry, weight: entry.weight * (1 - closedMix), bounds: eye.open })),
          { image: this.images.blink, weight: closedMix, bounds: eye.closed },
        ], eye.region, target);
      }
    }
    this.context.restore();
    this.drawGrain();
  }

  // Balanced light/dark grain on the portrait only unifies the photo and the
  // composited patches, and hides their feathered edges.
  drawGrain() {
    this.grainPattern ||= createGrainPattern(this.context);
    if (!this.grainPattern) return;
    const offset = this.reducedMotion ? 0 : Math.floor(Math.random() * 128);
    this.context.save();
    this.context.globalCompositeOperation = "source-atop";
    this.context.translate(offset, offset * 0.61);
    this.context.fillStyle = this.grainPattern;
    this.context.fillRect(-offset, -offset, this.canvas.width + 128, this.canvas.height + 128);
    this.context.restore();
  }

  drawFeature(entries, region, targetBounds, targetOuter) {
    const [x, y, width, height] = region;
    const patchWidth = Math.max(1, Math.ceil(width));
    const patchHeight = Math.max(1, Math.ceil(height));
    this.patchCache ||= new Map();
    const key = `${patchWidth}:${patchHeight}`;
    if (!this.patchCache.has(key)) this.patchCache.set(key, createCanvas(patchWidth, patchHeight));
    const patch = this.patchCache.get(key);
    const patchContext = patch.getContext("2d");
    patchContext.setTransform(1, 0, 0, 1, 0, 0);
    patchContext.clearRect(0, 0, patchWidth, patchHeight);
    // Add normalized premultiplied layers on a transparent surface. Sequential
    // source-over fades would leak the base mouth/eyes through at every transition.
    patchContext.globalCompositeOperation = "lighter";
    for (const { image, weight, bounds, outer } of entries) {
      if (!image || weight <= 0) continue;
      patchContext.globalAlpha = weight;
      if (bounds && targetBounds) drawWarped(patchContext, image, region, bounds, targetBounds, outer, targetOuter);
      else patchContext.drawImage(image, x, y, width, height, 0, 0, patchWidth, patchHeight);
    }
    patchContext.globalAlpha = 1;
    patchContext.globalCompositeOperation = "destination-in";
    // An elliptical mask reaches zero at ALL four edges, including short edges.
    patchContext.save();
    patchContext.scale(patchWidth / 2, patchHeight / 2);
    const feather = patchContext.createRadialGradient(1, 1, 0, 1, 1, 1);
    feather.addColorStop(0, "rgba(0,0,0,1)");
    feather.addColorStop(0.78, "rgba(0,0,0,1)");
    feather.addColorStop(1, "rgba(0,0,0,0)");
    patchContext.fillStyle = feather;
    patchContext.fillRect(0, 0, 2, 2);
    patchContext.restore();
    this.context.drawImage(patch, x, y, width, height);
  }

  reset() {
    this.state = DEFAULT_STATE;
    this.setEmotion("neutral", { immediate: true });
    this.viseme = "none";
    this.visemeMix = 1;
    this.targetMouthWeight = 0;
    this.mouthWeight = 0;
    this.blinkProgress = 0;
    this.blinkDirection = 0;
    this.blinkTimer = randomBetween(2, 6);
    this.blinkDepth = 1;
    this.pendingDoubleBlink = false;
    this.outputLevel = 0;
    this.levelAverage = 0;
    this.speechPresence = 0;
    this.gesture = null;
    this.browStartedAt = -Infinity;
    this.render();
  }

  dispose() {
    this.loadToken = (this.loadToken || 0) + 1;
    this.resizeObserver?.disconnect();
    this.motionMedia?.removeEventListener?.("change", this.motionListener);
    this.images = { base: null, blink: null, visemes: new Map(), emotions: new Map(), gaze: new Map() };
    this.patchCache?.clear();
    this.loaded = false;
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

function blendWeights(from, target, progress) {
  const weights = {};
  for (const [name, weight] of Object.entries(from)) {
    if (weight * (1 - progress) > 0) weights[name] = weight * (1 - progress);
  }
  weights[target] = (weights[target] || 0) + progress;
  return weights;
}

function createCanvas(width, height) {
  const canvas = globalThis.OffscreenCanvas ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createGrainPattern(context) {
  const size = 128;
  const tile = createCanvas(size, size);
  const tileContext = tile.getContext("2d");
  const pixels = tileContext.createImageData(size, size);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const value = Math.random() < 0.5 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = Math.round(Math.random() * 12);
  }
  tileContext.putImageData(pixels, 0, 0);
  return context.createPattern(tile, "repeat");
}

// Separate inner/outer lip anchors preserve lip thickness while closing the jaw.
function drawWarped(context, image, region, source, target, outer, targetOuter) {
  const [x, y, width, height] = region;
  const sx = outer ? [x, outer[0], source[0], source[2], outer[2], x + width] : [x, source[0], source[2], x + width];
  const sy = outer ? [y, outer[1], source[1], source[3], outer[3], y + height] : [y, source[1], source[3], y + height];
  const dx = (targetOuter ? [x, targetOuter[0], target[0], target[2], targetOuter[2], x + width] : [x, target[0], target[2], x + width]).map((value) => Math.round(value - x));
  const dy = (targetOuter ? [y, targetOuter[1], target[1], target[3], targetOuter[3], y + height] : [y, target[1], target[3], y + height]).map((value) => Math.round(value - y));
  for (let row = 0; row < sy.length - 1; row++) {
    for (let col = 0; col < sx.length - 1; col++) {
      context.drawImage(image, sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
        dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
    }
  }
}

async function loadImage(src) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  return image;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

