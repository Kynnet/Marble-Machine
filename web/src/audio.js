import * as Tone from 'tone';

// Two hits on the same obstacle closer together than this are one hit musically;
// without it a grazing contact machine-guns the same note.
const RETRIGGER_MS = 55;
const PARK_DELAY_MS = 160;

const PATCHES = {
  wood: {
    voice: Tone.Synth,
    options: {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.25 },
    },
    gain: 0.5,
  },
  bell: {
    voice: Tone.FMSynth,
    options: {
      harmonicity: 3.01,
      modulationIndex: 9,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.9 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 },
    },
    gain: 0.32,
  },
  pluck: {
    voice: Tone.AMSynth,
    options: {
      harmonicity: 2,
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.15 },
    },
    gain: 0.35,
  },
};

/**
 * Owns the audio graph. Built lazily on a user gesture because browsers refuse
 * to start an AudioContext outside one.
 */
export class MarbleSynth {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.instruments = new Map();
    this.lastHitAt = new Map();
    this.parkTimer = null;
  }

  /** Idempotent, and safe to call from every entry point. */
  async unlock() {
    this.#cancelPark();
    await Tone.start();
    if (this.ready) return;

    this.reverb = new Tone.Reverb({ decay: 2.6, wet: 0.25 }).toDestination();
    for (const [name, patch] of Object.entries(PATCHES)) {
      const synth = new Tone.PolySynth(patch.voice, patch.options);
      synth.maxPolyphony = 12;
      synth.volume.value = Tone.gainToDb(patch.gain);
      synth.connect(this.reverb);
      this.instruments.set(name, synth);
    }
    this.ready = true;
  }

  get running() {
    return this.ready && Tone.getContext().rawContext.state === 'running';
  }

  /**
   * Plays one collision. `speed` is the marble's impact speed, used only for
   * loudness — pitch comes from the obstacle, so a given object always sings
   * the same note.
   */
  play({ id, note, timbre, speed = 8 }) {
    if (!this.running || this.muted) return false;
    const now = performance.now();
    if (now - (this.lastHitAt.get(id) ?? -Infinity) < RETRIGGER_MS) return false;
    this.lastHitAt.set(id, now);

    const instrument = this.instruments.get(timbre) ?? this.instruments.get('wood');
    if (!instrument) return false;
    const velocity = Math.min(1, 0.35 + speed / 20);
    // Event-driven sound schedules at "now": the future of a physics sim is unknown.
    instrument.triggerAttackRelease(note, 0.6, Tone.now(), velocity);
    return true;
  }

  playAll(hits) {
    let played = 0;
    for (const hit of hits) if (this.play(hit)) played += 1;
    return played;
  }

  /** Fades live voices and drains the reverb, but leaves the clock running. */
  silence() {
    if (!this.ready) return;
    for (const instrument of this.instruments.values()) instrument.releaseAll();
    this.lastHitAt.clear();
  }

  /**
   * The hard guarantee. Suspending the context is the only level that cannot be
   * defeated by a stray event slipping through on the next frame.
   */
  stop() {
    this.silence();
    this.#cancelPark();
    // Let the releases finish first; suspending mid-ramp freezes a note in place.
    this.parkTimer = setTimeout(() => {
      const ctx = Tone.getContext().rawContext;
      if (ctx.state === 'running') ctx.suspend();
    }, PARK_DELAY_MS);
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.stop();
    else if (this.ready) this.unlock();
  }

  #cancelPark() {
    clearTimeout(this.parkTimer);
    this.parkTimer = null;
  }
}

export const synth = new MarbleSynth();
