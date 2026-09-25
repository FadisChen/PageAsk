import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { AVATAR_EMOTIONS, AVATAR_EMOTION_HOLD_SECONDS } from "./emotions.js";
import { AvatarGesturePlayer } from "./gestures.js";

const NATURAL_ARM_DROP = 1.25;
const PLACEMENT_YAW = THREE.MathUtils.degToRad(8);
const SHA_MOUTH_INTENSITY = 0.45;
const EXPRESSION_ALIASES = {
  neutral: ["neutral", "Neutral"],
  happy: ["happy", "Happy", "joy", "Joy", "smile"],
  sad: ["sad", "Sad"],
  angry: ["angry", "Angry"],
  surprised: ["surprised", "Surprised"],
  aa: ["aa", "A", "a", "mouthA", "mouth_aa", "vowelA"],
  ih: ["ih", "I", "i", "mouthI", "mouth_ih", "vowelI"],
  ou: ["ou", "U", "u", "mouthU", "mouth_ou", "vowelU"],
  ee: ["ee", "E", "e", "mouthE", "mouth_ee", "vowelE"],
  oh: ["oh", "O", "o", "mouthO", "mouth_oh", "vowelO"],
  blink: ["blink", "Blink", "eyesClosed"],
  blinkLeft: ["blinkLeft", "Blink_L", "blink_l", "eyeBlinkLeft"],
  blinkRight: ["blinkRight", "Blink_R", "blink_r", "eyeBlinkRight"],
};

const normalizeName = (value) => String(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const randomBetween = (min, max) => min + Math.random() * (max - min);

export class VrmAvatarController {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.vrm = null;
    this.loaded = false;
    this.loadToken = 0;
    this.bones = {};
    this.restPose = new Map();
    this.expressions = {};
    this.gestures = new AvatarGesturePlayer();
    this.state = "idle";
    this.emotion = "neutral";
    this.emotionFrom = "neutral";
    this.emotionMix = 1;
    this.emotionReleaseAt = null;
    this.viseme = "none";
    this.mouthWeight = 0;
    this.outputLevel = 0;
    this.elapsed = 0;
    this.blinkTimer = randomBetween(2, 6);
    this.blinkProgress = 0;
    this.blinkDirection = 0;
    this.targetYaw = Math.PI - PLACEMENT_YAW;
    this.yaw = Math.PI - PLACEMENT_YAW;
    this.zoom = 1;
    this.basePosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3(0, 1.5, 0);
    this.euler = new THREE.Euler();
    this.quaternion = new THREE.Quaternion();
    this.setupScene();
    this.bindPointerRotation();
  }

  async load(modelUrl) {
    if (!this.renderer || !this.scene || !this.camera) return false;
    const requestToken = ++this.loadToken;
    this.loaded = false;
    this.gestures.reset(true);
    this.disposeModel();
    this.callbacks.onLoading?.(0);
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    try {
      const gltf = await loader.loadAsync(modelUrl, (progress) => {
        if (requestToken !== this.loadToken) return;
        this.callbacks.onLoading?.(progress.total ? clamp(progress.loaded / progress.total) : 0);
      });
      if (requestToken !== this.loadToken) {
        VRMUtils.deepDispose(gltf.scene);
        return false;
      }
      const loadedVrm = gltf.userData.vrm;
      if (!loadedVrm?.scene) throw new Error("VRM 模型沒有可顯示的 scene。");
      this.vrm = loadedVrm;
      this.scene.add(loadedVrm.scene);
      this.prepareModel();
      this.loaded = true;
      this.callbacks.onReady?.();
      return true;
    } catch (error) {
      if (requestToken === this.loadToken) this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  setState(state) { this.state = state; }

  setEmotion(emotion) {
    if (!AVATAR_EMOTIONS.includes(emotion) || emotion === this.emotion) return;
    this.emotionFrom = this.emotion;
    this.emotion = emotion;
    this.emotionMix = 0;
  }

  setViseme(viseme, weight, rms) {
    this.viseme = viseme;
    this.mouthWeight = clamp(weight);
    this.outputLevel = clamp((Number(rms) || 0) * 3.5);
  }

  playGesture(gesture) { this.gestures.queue(gesture); }
  finishTurn() { this.gestures.finishTurn(); }
  resetAnimation() { this.gestures.reset(); this.setEmotion("neutral"); this.setViseme("none", 0, 0); }
  finishSpeech() {
    this.gestures.reset();
    if (this.emotion !== "neutral") {
      this.emotionReleaseAt = this.elapsed + AVATAR_EMOTION_HOLD_SECONDS;
    }
    this.setViseme("none", 0, 0);
  }

  update(deltaTime, audioPlaying = false) {
    const delta = Math.min(0.1, Math.max(0, Number(deltaTime) || 0));
    this.elapsed += delta;
    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-delta * 10));
    if (this.vrm?.scene) this.vrm.scene.rotation.y = this.yaw;
    if (this.emotionReleaseAt !== null) {
      if (audioPlaying) this.emotionReleaseAt = Math.max(this.emotionReleaseAt, this.elapsed + AVATAR_EMOTION_HOLD_SECONDS);
      else if (this.elapsed >= this.emotionReleaseAt) this.setEmotion("neutral");
    }
    if (this.emotionMix < 1) this.emotionMix = Math.min(1, this.emotionMix + delta / 0.3);
    this.updateBlink(delta);
    if (this.loaded && this.vrm) {
      this.resetPose();
      this.animatePose();
      for (const [name, angles] of Object.entries(this.gestures.update(delta, audioPlaying))) {
        this.applyBoneOffset(name, angles[0], angles[1], angles[2], true);
      }
      this.applyExpressions();
      this.vrm.update?.(delta);
    }
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    ++this.loadToken;
    this.disposeModel();
    this.restPose.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  setupScene() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(25, 1, 0.01, 100);
      this.camera.position.set(0, 1.55, 8.2);
      this.camera.lookAt(this.cameraTarget);
      this.scene.add(new THREE.HemisphereLight(0xc9c4ff, 0x19152e, 1.8));
      const keyLight = new THREE.DirectionalLight(0xffd6c6, 3.2);
      keyLight.position.set(-2.5, 4.5, 4);
      this.scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0x9dacf8, 1.8);
      fillLight.position.set(3.5, 2.4, 2.5);
      this.scene.add(fillLight);
      const rimLight = new THREE.PointLight(0x86e4ce, 3.2, 8, 2);
      rimLight.position.set(0, 2.5, -1.8);
      this.scene.add(rimLight);
      this.resize();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || 300);
    const height = Math.max(1, rect.height || 350);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  bindPointerRotation() {
    let pointerId = null;
    let previousX = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      pointerId = event.pointerId;
      previousX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      this.targetYaw += (event.clientX - previousX) * 0.008;
      previousX = event.clientX;
    });
    const release = (event) => { if (pointerId === event.pointerId) pointerId = null; };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("wheel", (event) => {
      if (!this.camera) return;
      event.preventDefault();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-delta * 0.001), 0.72, 2.15);
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }, { passive: false });
  }

  disposeModel() {
    if (this.vrm?.scene && this.scene) this.scene.remove(this.vrm.scene);
    if (this.vrm?.scene) VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
    this.loaded = false;
    this.bones = {};
    this.restPose.clear();
    this.expressions = {};
  }

  prepareModel() {
    if (!this.vrm?.scene || !this.camera) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const targetHeight = 3.35;
    this.vrm.scene.scale.setScalar(targetHeight / Math.max(size.y, 0.01));
    const scaledBox = new THREE.Box3().setFromObject(this.vrm.scene);
    const center = scaledBox.getCenter(new THREE.Vector3());
    this.vrm.scene.position.x -= center.x;
    this.vrm.scene.position.y -= scaledBox.min.y;
    this.vrm.scene.position.z -= center.z;
    this.basePosition.copy(this.vrm.scene.position);
    const targetY = targetHeight * 0.78;
    const visibleHeight = targetHeight * 0.42;
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.cameraTarget.set(0, targetY, 0);
    this.camera.position.set(0, targetY, distance);
    this.zoom = 1;
    this.camera.zoom = 1;
    this.camera.lookAt(this.cameraTarget);
    this.resolveBones();
    this.resolveExpressions();
    this.applyExpressions();
    this.resize();
  }

  resolveBones() {
    const humanoid = this.vrm?.humanoid;
    if (!humanoid) return;
    const getBone = (name) => humanoid.getNormalizedBoneNode?.(name) || humanoid.getRawBoneNode?.(name) || null;
    this.bones = {
      hips: getBone("hips"), spine: getBone("spine"), chest: getBone("chest"), neck: getBone("neck"), head: getBone("head"),
      leftShoulder: getBone("leftShoulder"), rightShoulder: getBone("rightShoulder"), leftUpperArm: getBone("leftUpperArm"), leftLowerArm: getBone("leftLowerArm"), leftHand: getBone("leftHand"),
      rightUpperArm: getBone("rightUpperArm"), rightLowerArm: getBone("rightLowerArm"), rightHand: getBone("rightHand"),
    };
    for (const finger of ["Index", "Middle", "Ring", "Little"]) for (const segment of ["Proximal", "Intermediate", "Distal"]) this.bones[`right${finger}${segment}`] = getBone(`right${finger}${segment}`);
    this.bones.rightThumbMetacarpal = getBone("rightThumbMetacarpal");
    for (const bone of new Set(Object.values(this.bones).filter(Boolean))) this.restPose.set(bone, bone.quaternion.clone());
  }

  resolveExpressions() {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    const names = Object.keys(manager.expressionMap || {});
    const normalized = new Map(names.map((name) => [normalizeName(name), name]));
    this.expressions = {};
    for (const [logical, candidates] of Object.entries(EXPRESSION_ALIASES)) {
      this.expressions[logical] = candidates.find((candidate) => names.includes(candidate) || Boolean(manager.getExpression?.(candidate)))
        || candidates.map(normalizeName).map((name) => normalized.get(name)).find(Boolean)
        || null;
    }
  }

  setExpression(name, weight) {
    const manager = this.vrm?.expressionManager;
    const expression = this.expressions[name];
    if (manager?.setValue && expression) manager.setValue(expression, clamp(weight));
  }

  applyExpressions() {
    for (const name of AVATAR_EMOTIONS) {
      const weight = name === this.emotion ? this.emotionMix : name === this.emotionFrom ? 1 - this.emotionMix : 0;
      const mouthExpression = name === "happy" || name === "surprised";
      this.setExpression(name, mouthExpression ? weight * SHA_MOUTH_INTENSITY : weight);
    }
    for (const name of ["aa", "ih", "ou", "ee", "oh"]) this.setExpression(name, name === this.viseme ? this.mouthWeight * SHA_MOUTH_INTENSITY : 0);
    if (this.expressions.blink) this.setExpression("blink", this.blinkProgress);
    else { this.setExpression("blinkLeft", this.blinkProgress); this.setExpression("blinkRight", this.blinkProgress); }
  }

  resetPose() { for (const [bone, quaternion] of this.restPose) bone.quaternion.copy(quaternion); }

  applyBoneOffset(name, x, y, z, multiply = false) {
    const bone = this.bones[name];
    const rest = this.restPose.get(bone);
    if (!bone || !rest) return;
    this.euler.set(x, y, z);
    this.quaternion.setFromEuler(this.euler);
    if (multiply) bone.quaternion.multiply(this.quaternion);
    else bone.quaternion.copy(rest).multiply(this.quaternion);
  }

  animatePose() {
    const t = this.elapsed;
    const listening = this.state === "listening" ? 1 : 0;
    const thinking = this.state === "thinking" ? 1 : 0;
    const speaking = this.state === "speaking" ? 1 : 0;
    const interrupted = this.state === "interrupted" ? 1 : 0;
    const breath = Math.sin(t * 1.52 + Math.sin(t * 0.17) * 0.2) * 0.018;
    const shift = Math.sin(t * 0.37 + 0.4) * 0.025 + Math.sin(t * 0.19 + 2.2) * 0.012;
    const gazeYaw = Math.sin(t * 0.23 + 0.5) * 0.022 + Math.sin(t * 0.071 + 1.8) * 0.018;
    const gazePitch = Math.sin(t * 0.29 + 2.4) * 0.011;
    const speechBeat = Math.sin(t * 2.4) + Math.sin(t * 4.1 + 1.1) * 0.32;
    const energy = speaking * (0.25 + this.outputLevel * 0.75);
    const pitch = breath * 0.35 + gazePitch + listening * Math.pow(Math.max(0, Math.sin(t * 0.68 - 0.7)), 10) * 0.035 + speechBeat * 0.016 * energy + interrupted * 0.025;
    const yaw = gazeYaw + shift * 0.45 + Math.sin(t * 0.91 + 0.8) * 0.018 * energy - thinking * 0.035;
    const roll = Math.sin(t * 0.31 + 0.8) * 0.016 + listening * Math.sin(t * 0.75) * 0.018 + thinking * (Math.sin(t * 0.8) * 0.035 - 0.055);
    const bodyBob = breath * 0.25 + speechBeat * 0.005 * energy;
    const armDrift = Math.sin(t * 0.53 + 0.4) * 0.018 + Math.sin(t * 0.21 + 2) * 0.009;
    const elbowRelax = 0.05 + Math.sin(t * 0.47 + 1.5) * 0.012;
    this.applyBoneOffset("hips", 0, shift * 0.2, shift * 0.12);
    this.applyBoneOffset("spine", breath * 0.18 - listening * 0.008, shift * 0.22, -shift * 0.12);
    this.applyBoneOffset("chest", breath * 0.45 + speechBeat * 0.006 * energy, shift * 0.42, shift * 0.2);
    this.applyBoneOffset("leftShoulder", 0, 0, shift * 0.32);
    this.applyBoneOffset("rightShoulder", 0, 0, shift * 0.23);
    this.applyBoneOffset("neck", pitch * 0.35, yaw * 0.35, roll * 0.35);
    this.applyBoneOffset("head", pitch, yaw, roll);
    this.applyBoneOffset("leftUpperArm", 0, 0, NATURAL_ARM_DROP + armDrift - shift * 0.16);
    this.applyBoneOffset("leftLowerArm", -elbowRelax, 0, 0);
    this.applyBoneOffset("rightUpperArm", 0, 0, -NATURAL_ARM_DROP + armDrift * 0.76 + shift * 0.13);
    this.applyBoneOffset("rightLowerArm", -elbowRelax, 0, 0);
    if (this.vrm?.scene) { this.vrm.scene.position.x = this.basePosition.x + shift * 0.018; this.vrm.scene.position.y = this.basePosition.y + bodyBob; }
  }

  updateBlink(deltaTime) {
    this.blinkTimer -= deltaTime;
    if (this.blinkDirection === 0 && this.blinkTimer <= 0) { this.blinkDirection = 1; this.blinkTimer = 0.075; }
    if (this.blinkDirection === 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + deltaTime / 0.075);
      if (this.blinkProgress >= 1) { this.blinkDirection = -1; this.blinkTimer = 0.075; }
    } else if (this.blinkDirection === -1) {
      this.blinkProgress = Math.max(0, this.blinkProgress - deltaTime / 0.075);
      if (this.blinkProgress <= 0) { this.blinkDirection = 0; this.blinkTimer = randomBetween(2, 6); }
    }
  }
}
