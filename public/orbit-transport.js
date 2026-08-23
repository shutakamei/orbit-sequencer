const STEPS = 12;
const TAU = Math.PI * 2;
const SCALE = [0, 2, 4, 7, 9, 11];
const VOICES = [
  { id: "tide", period: 4, offset: 1, pan: -.4 },
  { id: "moss", period: 8, offset: 2, pan: -.2 },
  { id: "rain", period: 5, offset: 3, pan: 0 },
  { id: "dusk", period: 12, offset: 4, pan: .2 },
  { id: "pollen", period: 3, offset: .5, pan: .4 },
];

const mod = (value, size) => ((value % size) + size) % size;
const midi = (note) => 440 * Math.pow(2, (note - 69) / 12);

class OrbitTransport extends AudioWorkletProcessor {
  constructor() {
    super();
    this.playing = false;
    this.tempo = 76;
    this.beat = 0;
    this.sequences = {};
    this.muted = [];
    this.lastSteps = {};
    this.tones = [];
    this.syncSamples = 0;
    this.seed = 74123;
    this.visualUpdates = true;
    this.resetSteps();
    this.port.onmessage = ({ data }) => {
      if (data.type === "state") {
        this.tempo = data.tempo;
        this.sequences = data.sequences;
        this.muted = data.muted;
        this.beat = data.beat;
        this.playing = data.playing;
        this.resetSteps();
      } else if (data.type === "tempo") {
        this.tempo = data.value;
      } else if (data.type === "sequences") {
        this.sequences = data.value;
        this.resetSteps();
      } else if (data.type === "muted") {
        this.muted = data.value;
      } else if (data.type === "playing") {
        this.playing = data.value;
        this.resetSteps();
      } else if (data.type === "visibility") {
        this.visualUpdates = data.value;
        if (this.visualUpdates) this.port.postMessage({ type: "sync", beat: this.beat });
      }
    };
  }

  resetSteps() {
    for (const voice of VOICES) {
      this.lastSteps[voice.id] = Math.floor((this.beat - voice.offset) * STEPS / voice.period);
    }
  }

  trigger(voice, hit) {
    const add = (frequency, duration, amplitude, shape = "sine", overtone = 0) => {
      this.tones.push({ frequency, duration, amplitude, shape, overtone, pan: voice.pan, age: 0, phase: 0 });
    };
    if (voice.id === "tide") {
      add(midi([38, 38, 43, 36][mod(hit, 4)]), 1.05, .34);
    } else if (voice.id === "moss") {
      const root = [50, 47, 45][mod(hit, 3)];
      [0, 4, 7, 11].forEach((interval, index) => add(midi(root + interval), 2.8, .048, index % 2 ? "triangle" : "sine"));
    } else if (voice.id === "rain") {
      add(midi(67 + SCALE[mod(hit * 2, SCALE.length)]), 1.7, .12, "sine", .14);
    } else if (voice.id === "dusk") {
      add(midi([45, 43, 38][mod(hit, 3)]), 3.2, .2, "sine", .16);
    } else {
      this.tones.push({ duration: .06, amplitude: .12, shape: "noise", pan: voice.pan, age: 0 });
    }
    if (this.visualUpdates) this.port.postMessage({ type: "hit", voice: voice.id, step: mod(hit, STEPS) });
  }

  oscillator(tone) {
    if (tone.shape === "noise") {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return (this.seed / 2147483648 - 1) * Math.sin(Math.PI * Math.min(1, tone.age * 9000));
    }
    tone.phase += TAU * tone.frequency / sampleRate;
    const fundamental = tone.shape === "triangle" ? 2 / Math.PI * Math.asin(Math.sin(tone.phase)) : Math.sin(tone.phase);
    return fundamental + tone.overtone * Math.sin(tone.phase * 2.01);
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    const beatPerSample = this.tempo / 60 / sampleRate;

    for (let index = 0; index < left.length; index++) {
      if (this.playing) {
        this.beat += beatPerSample;
        for (const voice of VOICES) {
          const hit = Math.floor((this.beat - voice.offset) * STEPS / voice.period);
          if (hit > this.lastSteps[voice.id]) {
            this.lastSteps[voice.id] = hit;
            const sequence = this.sequences[voice.id] || [];
            if (!this.muted.includes(voice.id) && sequence[mod(hit, STEPS)]) this.trigger(voice, hit);
          }
        }
      }

      let sampleLeft = 0;
      let sampleRight = 0;
      for (const tone of this.tones) {
        const progress = tone.age / tone.duration;
        const attack = tone.shape === "noise" ? .001 : tone.duration > 2 ? .12 : .018;
        const envelope = tone.age < attack ? tone.age / attack : Math.pow(Math.max(0, 1 - progress), tone.shape === "noise" ? 5 : 2.4);
        const sample = this.oscillator(tone) * envelope * tone.amplitude;
        const panLeft = Math.sqrt((1 - tone.pan) / 2);
        const panRight = Math.sqrt((1 + tone.pan) / 2);
        sampleLeft += sample * panLeft;
        sampleRight += sample * panRight;
        tone.age += 1 / sampleRate;
      }
      this.tones = this.tones.filter((tone) => tone.age < tone.duration);
      left[index] = Math.tanh(sampleLeft * 1.12);
      right[index] = Math.tanh(sampleRight * 1.12);
    }

    this.syncSamples += left.length;
    if (this.syncSamples >= 2048) {
      this.syncSamples = 0;
      if (this.visualUpdates) this.port.postMessage({ type: "sync", beat: this.beat });
    }
    return true;
  }
}

registerProcessor("orbit-transport", OrbitTransport);
