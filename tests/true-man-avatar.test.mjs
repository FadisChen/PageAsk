import assert from "node:assert/strict";
import test from "node:test";
import { getBrowLift, getGestureMotion } from "../js/avatar/true-man-avatar-controller.js";

test("真人 gestures start and end at rest and stay photo-safe", () => {
  for (const name of ["nod", "listen_nod", "shake_head", "tilt_head", "bow", "wave", "salute"]) {
    const start = getGestureMotion(name, 0);
    assert.equal(start.nod, 0);
    assert.equal(start.lean, 0);
    let peakNod = 0;
    let peakLean = 0;
    let time = 0;
    for (; !getGestureMotion(name, time).done; time += 0.01) {
      const { nod, lean } = getGestureMotion(name, time);
      peakNod = Math.max(peakNod, Math.abs(nod));
      peakLean = Math.max(peakLean, Math.abs(lean));
    }
    assert.ok(time < 2.5, `${name} ends`);
    assert.ok(peakNod > 0 || peakLean > 0, `${name} moves`);
    // Larger motion reveals that the avatar is a single flat photograph.
    assert.ok(peakNod <= 8 && peakLean <= 0.012, `${name} stays small`);
  }
});

test("真人 gestures never lift the portrait above its resting position", () => {
  for (const name of ["nod", "listen_nod", "shake_head", "tilt_head", "bow", "shrug"]) {
    for (let time = 0; time < 2.5; time += 0.01) assert.ok(getGestureMotion(name, time).nod >= 0, `${name} at ${time}`);
  }
});

test("真人 brow flash rises quickly and fades out", () => {
  assert.equal(getBrowLift(-0.1), 0);
  assert.equal(getBrowLift(0), 0);
  assert.equal(getBrowLift(0.08), 1);
  assert.ok(getBrowLift(0.3) < 0.5);
  assert.ok(getBrowLift(1.5) < 0.02);
});
