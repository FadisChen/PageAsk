export const AVATAR_STATES = Object.freeze(["idle", "listening", "thinking", "speaking", "interrupted"]);

export class AvatarStateMachine {
  constructor() { this.state = "idle"; }
  set(next) { if (AVATAR_STATES.includes(next)) this.state = next; }
  toListening() { this.state = "listening"; }
  toSpeaking() { if (this.state === "thinking" || this.state === "listening") this.state = "speaking"; }
}
