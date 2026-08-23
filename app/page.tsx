"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Voice = {
  id: string;
  name: string;
  role: string;
  color: string;
  glow: string;
  radius: number;
  size: number;
  period: number;
  offset: number;
  gateAngle: number;
  rotation: number;
};

type AudioSessionNavigator = Navigator & {
  audioSession?: { type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" };
};

const TAU = Math.PI * 2;
const STEPS = 12;
const VOICES: Voice[] = [
  { id: "tide", name: "TIDE", role: "soft bass", color: "#ff7f67", glow: "255,127,103", radius: .19, size: 15, period: 4, offset: 1, gateAngle: -1.3, rotation: -.16 },
  { id: "moss", name: "MOSS", role: "warm chords", color: "#b7e377", glow: "183,227,119", radius: .29, size: 12, period: 8, offset: 2, gateAngle: .15, rotation: .08 },
  { id: "rain", name: "RAIN", role: "glass notes", color: "#75d9d1", glow: "117,217,209", radius: .39, size: 9, period: 5, offset: 3, gateAngle: 2.5, rotation: -.08 },
  { id: "dusk", name: "DUSK", role: "low bell", color: "#b9a7ff", glow: "185,167,255", radius: .5, size: 17, period: 12, offset: 4, gateAngle: 3.55, rotation: .13 },
  { id: "pollen", name: "POLLEN", role: "bright dust", color: "#f7d46b", glow: "247,212,107", radius: .35, size: 7, period: 3, offset: .5, gateAngle: 1.12, rotation: .02 },
];

const makeSteps = (...active: number[]) => Array.from({ length: STEPS }, (_, i) => active.includes(i));
const DEFAULT_SEQUENCES: Record<string, boolean[]> = {
  tide: makeSteps(0),
  moss: makeSteps(0),
  rain: makeSteps(0, 7),
  dusk: makeSteps(0),
  pollen: makeSteps(0, 5, 9),
};

const SCALE = [0, 2, 4, 7, 9, 11];
const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);
const mod = (n: number, m: number) => ((n % m) + m) % m;
const noise = (seed: number) => { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); };

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const syncRef = useRef({ beat: 0, audioTime: 0 });
  const beatRef = useRef(0);
  const playingRef = useRef(false);
  const tempoRef = useRef(76);
  const driftRef = useRef(36);
  const mutedRef = useRef<Set<string>>(new Set());
  const sequencesRef = useRef<Record<string, boolean[]>>(DEFAULT_SEQUENCES);
  const pulsesRef = useRef<Record<string, number>>({});
  const hitGateRef = useRef<Record<string, number>>({});
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const gatePositionsRef = useRef<Record<string, { x: number; y: number }[]>>({});
  const selectedVoiceRef = useRef("tide");
  const lastTurnRef = useRef<Record<string, number>>({});
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(76);
  const [drift, setDrift] = useState(36);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [sequences, setSequences] = useState<Record<string, boolean[]>>(DEFAULT_SEQUENCES);
  const [selectedVoice, setSelectedVoice] = useState("tide");
  const [clock, setClock] = useState("00 · 00 · 00");

  useEffect(() => {
    tempoRef.current = tempo;
    workletRef.current?.port.postMessage({ type: "tempo", value: tempo });
  }, [tempo]);
  useEffect(() => { driftRef.current = drift; }, [drift]);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => {
    mutedRef.current = muted;
    workletRef.current?.port.postMessage({ type: "muted", value: [...muted] });
  }, [muted]);
  useEffect(() => {
    sequencesRef.current = sequences;
    workletRef.current?.port.postMessage({ type: "sequences", value: sequences });
  }, [sequences]);

  const toggleVoice = useCallback((id: string) => {
    setMuted((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      mutedRef.current = next;
      return next;
    });
  }, []);

  const toggleStep = useCallback((voiceId: string, step: number) => {
    setSequences((current) => {
      const next = { ...current, [voiceId]: [...current[voiceId]] };
      next[voiceId][step] = !next[voiceId][step];
      sequencesRef.current = next;
      return next;
    });
    lastTurnRef.current = {};
    pulsesRef.current = {};
  }, []);

  const makeTone = useCallback((voice: string, hit: number) => {
    const ctx = audioRef.current;
    const master = masterRef.current;
    if (!ctx || !master || mutedRef.current.has(voice)) return;
    const when = ctx.currentTime + .006;
    const out = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = (VOICES.findIndex((v) => v.id === voice) - 2) * .2;
    out.connect(pan).connect(master);
    pulsesRef.current[voice] = 1;

    if (voice === "tide") {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      osc.type = "sine";
      const bassFrequency = midi([38, 38, 43, 36][mod(hit, 4)]);
      osc.frequency.setValueAtTime(bassFrequency, when);
      filter.type = "lowpass";
      filter.frequency.value = 380;
      out.gain.setValueAtTime(.0001, when);
      out.gain.exponentialRampToValueAtTime(.34, when + .025);
      out.gain.exponentialRampToValueAtTime(.0001, when + 1.05);
      osc.connect(filter).connect(out);
      osc.start(when); osc.stop(when + 1.1);
    } else if (voice === "moss") {
      const root = [50, 47, 45][mod(hit, 3)];
      [0, 4, 7, 11].forEach((interval, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i % 2 ? "triangle" : "sine";
        osc.frequency.value = midi(root + interval);
        gain.gain.setValueAtTime(.0001, when);
        gain.gain.exponentialRampToValueAtTime(.052, when + .14);
        gain.gain.exponentialRampToValueAtTime(.0001, when + 2.8);
        osc.connect(gain).connect(out);
        osc.start(when); osc.stop(when + 2.9);
      });
    } else if (voice === "rain") {
      const osc = ctx.createOscillator();
      const delay = ctx.createDelay();
      const feedback = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = midi(67 + SCALE[mod(hit * 2, SCALE.length)]);
      delay.delayTime.value = 60 / tempoRef.current * .75;
      feedback.gain.value = .2;
      delay.connect(feedback).connect(delay);
      delay.connect(out); osc.connect(delay); osc.connect(out);
      out.gain.setValueAtTime(.0001, when);
      out.gain.exponentialRampToValueAtTime(.12, when + .008);
      out.gain.exponentialRampToValueAtTime(.0001, when + 1.7);
      osc.start(when); osc.stop(when + 1.8);
    } else if (voice === "dusk") {
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const harmonic = ctx.createGain();
      const f = midi([45, 43, 38][mod(hit, 3)]);
      osc.type = "sine"; overtone.type = "sine";
      osc.frequency.value = f; overtone.frequency.value = f * 2.01;
      harmonic.gain.value = .16;
      overtone.connect(harmonic).connect(out); osc.connect(out);
      out.gain.setValueAtTime(.0001, when);
      out.gain.exponentialRampToValueAtTime(.2, when + .03);
      out.gain.exponentialRampToValueAtTime(.0001, when + 3.2);
      osc.start(when); overtone.start(when); osc.stop(when + 3.3); overtone.stop(when + 3.3);
    } else {
      const length = Math.floor(ctx.sampleRate * .06);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (noise(i + hit * 97) * 2 - 1) * Math.pow(1 - i / length, 5);
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass"; filter.frequency.value = 5000;
      source.buffer = buffer; out.gain.value = .12;
      source.connect(filter).connect(out); source.start(when);
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    if (playingRef.current) {
      playingRef.current = false;
      workletRef.current?.port.postMessage({ type: "playing", value: false });
      if (audioRef.current && masterRef.current) {
        const now = audioRef.current.currentTime;
        masterRef.current.gain.cancelScheduledValues(now);
        masterRef.current.gain.setValueAtTime(Math.max(masterRef.current.gain.value, .0001), now);
        masterRef.current.gain.exponentialRampToValueAtTime(.0001, now + .12);
      }
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      setPlaying(false);
      return;
    }

    if (!audioRef.current) {
      const audioNavigator = navigator as AudioSessionNavigator;
      if (audioNavigator.audioSession) audioNavigator.audioSession.type = "playback";
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtor();
      const master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      master.gain.value = .56;
      master.connect(compressor).connect(ctx.destination);
      audioRef.current = ctx; masterRef.current = master;

      if (ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule("/orbit-transport.js");
          const worklet = new AudioWorkletNode(ctx, "orbit-transport", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          worklet.connect(master);
          worklet.port.onmessage = ({ data }: MessageEvent<{ type: string; beat?: number; voice?: string; step?: number }>) => {
            if (data.type === "sync" && typeof data.beat === "number") {
              beatRef.current = data.beat;
              syncRef.current = { beat: data.beat, audioTime: ctx.currentTime };
            } else if (data.type === "hit" && data.voice && typeof data.step === "number" && document.visibilityState === "visible") {
              pulsesRef.current[data.voice] = 1;
              hitGateRef.current[data.voice] = data.step;
            }
          };
          workletRef.current = worklet;
          worklet.port.postMessage({
            type: "state",
            tempo: tempoRef.current,
            sequences: sequencesRef.current,
            muted: [...mutedRef.current],
            beat: beatRef.current,
            playing: false,
          });
        } catch {
          workletRef.current = null;
        }
      }
    }
    await audioRef.current.resume();
    masterRef.current?.gain.setValueAtTime(.56, audioRef.current.currentTime);
    playingRef.current = true;
    workletRef.current?.port.postMessage({ type: "playing", value: true });
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Orbit Choir",
      artist: "Generative orbit sequencer",
      album: "Drift",
      artwork: [{ src: "/og.png", sizes: "1200x630", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => { if (!playingRef.current) void togglePlayback(); });
    navigator.mediaSession.setActionHandler("pause", () => { if (playingRef.current) void togglePlayback(); });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, [togglePlayback]);

  useEffect(() => {
    const updateVisibility = () => workletRef.current?.port.postMessage({ type: "visibility", value: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => () => {
    workletRef.current?.disconnect();
    audioRef.current?.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let previous = performance.now();
    let clockTick = -1;
    const dust = Array.from({ length: 48 }, (_, i) => ({ a: noise(i) * TAU, r: .08 + noise(i + 20) * .48, s: .006 + noise(i + 40) * .018, z: .4 + noise(i + 70) * 1.3 }));

    const draw = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .05);
      previous = now;
      if (playingRef.current && workletRef.current && audioRef.current) {
        beatRef.current = syncRef.current.beat + (audioRef.current.currentTime - syncRef.current.audioTime) * tempoRef.current / 60;
      } else if (playingRef.current) {
        beatRef.current += dt * tempoRef.current / 60;
      }
      const beat = beatRef.current;
      const tick = Math.floor(beat * 4);
      if (tick !== clockTick) {
        clockTick = tick;
        const bar = Math.floor(beat / 4);
        setClock(`${String(bar).padStart(2, "0")} · ${String(Math.floor(mod(beat, 4)) + 1).padStart(2, "0")} · ${String(mod(tick, 4) + 1).padStart(2, "0")}`);
      }
      const dpr = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height, cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) * .84;
      ctx.clearRect(0, 0, w, h);
      const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * .68);
      wash.addColorStop(0, "rgba(42,67,78,.38)"); wash.addColorStop(.56, "rgba(14,30,37,.11)"); wash.addColorStop(1, "rgba(6,16,22,0)");
      ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);

      dust.forEach((p, i) => {
        const a = p.a + now / 1000 * p.s * (i % 2 ? 1 : -1);
        const x = cx + Math.cos(a) * p.r * scale;
        const y = cy + Math.sin(a) * p.r * scale * .67;
        ctx.beginPath(); ctx.arc(x, y, p.z, 0, TAU);
        ctx.fillStyle = `rgba(226,239,225,${.1 + p.z * .07})`; ctx.fill();
      });

      const pointOnOrbit = (voice: Voice, angle: number, orbit: number, flat: number) => {
        const gateDistance = angle - voice.gateAngle;
        const wobble = Math.sin(gateDistance) * Math.sin(gateDistance * 2) * driftRef.current / 100 * orbit * .045;
        const rx = Math.cos(angle) * (orbit + wobble);
        const ry = Math.sin(angle) * (orbit + wobble) * flat;
        return {
          x: cx + rx * Math.cos(voice.rotation) - ry * Math.sin(voice.rotation),
          y: cy + rx * Math.sin(voice.rotation) + ry * Math.cos(voice.rotation),
        };
      };

      VOICES.forEach((voice, index) => {
        const orbit = voice.radius * scale;
        const flat = .56 + index * .028;
        const sequence = sequencesRef.current[voice.id];
        const isSelected = selectedVoiceRef.current === voice.id;
        const phase = mod((beat - voice.offset) / voice.period, 1);
        const angle = voice.gateAngle + phase * TAU;
        const hit = Math.floor((beat - voice.offset) * STEPS / voice.period);
        const hitStep = mod(hit, STEPS);
        if (lastTurnRef.current[voice.id] === undefined) lastTurnRef.current[voice.id] = hit;
        if (!workletRef.current && playingRef.current && hit > lastTurnRef.current[voice.id] && sequence[hitStep]) {
          hitGateRef.current[voice.id] = hitStep;
          makeTone(voice.id, hit);
        }
        lastTurnRef.current[voice.id] = hit;

        ctx.beginPath();
        for (let s = 0; s <= 140; s++) {
          const a = voice.gateAngle + s / 140 * TAU;
          const p = pointOnOrbit(voice, a, orbit, flat);
          if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.setLineDash(index % 2 ? [1, 7] : []);
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.strokeStyle = mutedRef.current.has(voice.id) ? "rgba(213,226,220,.045)" : isSelected ? `rgba(${voice.glow},.34)` : "rgba(213,226,220,.1)";
        ctx.stroke(); ctx.setLineDash([]);

        const lifted = mutedRef.current.has(voice.id);
        const voicePulse = pulsesRef.current[voice.id] ?? 0;
        pulsesRef.current[voice.id] = Math.max(0, voicePulse - dt * 1.75);

        gatePositionsRef.current[voice.id] = [];
        for (let gateIndex = 0; gateIndex < STEPS; gateIndex++) {
          const gateAngle = voice.gateAngle + gateIndex / STEPS * TAU;
          const gateBase = pointOnOrbit(voice, gateAngle, orbit, flat);
          gatePositionsRef.current[voice.id][gateIndex] = gateBase;
          const enabled = sequence[gateIndex];
          if (isSelected && !enabled) {
            const isCurrent = gateIndex === hitStep;
            ctx.beginPath(); ctx.arc(gateBase.x, gateBase.y, isCurrent ? 4.2 : 3.2, 0, TAU);
            ctx.fillStyle = `rgba(${voice.glow},${isCurrent ? .34 : .13})`; ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${voice.glow},${isCurrent ? .72 : .36})`; ctx.stroke();
          }
          if (!enabled) continue;
          const nearby = pointOnOrbit(voice, gateAngle + .01, orbit, flat);
          let tx = nearby.x - gateBase.x, ty = nearby.y - gateBase.y;
          const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          let nx = -ty, ny = tx;
          if ((gateBase.x - cx) * nx + (gateBase.y - cy) * ny < 0) { nx *= -1; ny *= -1; }
          const gx = gateBase.x + (lifted ? nx * 25 : 0);
          const gy = gateBase.y + (lifted ? ny * 25 : 0);
          const pulse = hitGateRef.current[voice.id] === gateIndex ? voicePulse : 0;

          ctx.beginPath();
          const segments = 18;
          for (let s = 0; s <= segments; s++) {
            const q = s / segments;
            const along = (q - .5) * 35;
            const vibration = Math.sin(q * Math.PI * 3) * pulse * 7 * Math.pow(1 - q, .25);
            const px = gx + tx * along + nx * vibration;
            const py = gy + ty * along + ny * vibration;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.lineWidth = lifted ? 1 : 1.6;
          ctx.strokeStyle = lifted ? "rgba(158,178,171,.14)" : `rgba(${voice.glow},${.42 + pulse * .52})`;
          ctx.shadowColor = lifted ? "transparent" : `rgba(${voice.glow},.7)`;
          ctx.shadowBlur = lifted ? 0 : 4 + pulse * 14;
          ctx.stroke(); ctx.shadowBlur = 0;
          [-1, 1].forEach((side) => {
            ctx.beginPath(); ctx.arc(gx + tx * side * 19, gy + ty * side * 19, 1.8, 0, TAU);
            ctx.fillStyle = lifted ? "rgba(151,170,164,.2)" : `rgba(${voice.glow},.62)`; ctx.fill();
          });
          if (isSelected) {
            ctx.beginPath(); ctx.arc(gateBase.x, gateBase.y, gateIndex === hitStep ? 7 : 5.5, 0, TAU);
            ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${voice.glow},${gateIndex === hitStep ? .9 : .52})`; ctx.stroke();
          }
          if (pulse > 0) {
            ctx.beginPath(); ctx.arc(gateBase.x, gateBase.y, 10 + (1 - pulse) * 44, 0, TAU);
            ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${voice.glow},${pulse * .52})`; ctx.stroke();
            ctx.beginPath(); ctx.arc(gateBase.x, gateBase.y, 4 + (1 - pulse) * 22, 0, TAU);
            ctx.strokeStyle = `rgba(${voice.glow},${pulse * .72})`; ctx.stroke();
          }
        }

        for (let trail = 9; trail >= 1; trail--) {
          const past = angle - trail * .026;
          const p = pointOnOrbit(voice, past, orbit, flat);
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, voice.size * (1 - trail / 11) * .42), 0, TAU);
          ctx.fillStyle = `rgba(${voice.glow},${(10 - trail) * .012})`; ctx.fill();
        }
        const orb = pointOnOrbit(voice, angle, orbit, flat);
        positionsRef.current[voice.id] = orb;
        const active = !lifted;
        const halo = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, voice.size * 3.2);
        halo.addColorStop(0, `rgba(${voice.glow},${active ? .7 : .17})`);
        halo.addColorStop(.28, `rgba(${voice.glow},${active ? .24 : .05})`);
        halo.addColorStop(1, `rgba(${voice.glow},0)`);
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(orb.x, orb.y, voice.size * 3.2, 0, TAU); ctx.fill();
        ctx.fillStyle = active ? voice.color : "rgba(132,149,148,.38)";
        ctx.beginPath(); ctx.arc(orb.x, orb.y, voice.size + voicePulse * 2.5, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.65)";
        ctx.beginPath(); ctx.arc(orb.x - voice.size * .28, orb.y - voice.size * .28, Math.max(1.3, voice.size * .12), 0, TAU); ctx.fill();

        const stepPosition = phase * STEPS;
        const stepFraction = mod(stepPosition, 1);
        let nextGateIndex = -1;
        let distanceToGate = STEPS;
        for (let distance = 1; distance <= STEPS; distance++) {
          const candidate = mod(Math.floor(stepPosition) + distance, STEPS);
          if (sequence[candidate]) { nextGateIndex = candidate; distanceToGate = distance - stepFraction; break; }
        }
        if (nextGateIndex >= 0 && distanceToGate < .8 && active) {
          const approach = 1 - distanceToGate / .8;
          const nextGate = pointOnOrbit(voice, voice.gateAngle + nextGateIndex / STEPS * TAU, orbit, flat);
          ctx.beginPath(); ctx.moveTo(orb.x, orb.y); ctx.lineTo(nextGate.x, nextGate.y);
          ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${voice.glow},${approach * .2})`; ctx.stroke(); ctx.setLineDash([]);
        }
      });

      ctx.save(); ctx.translate(cx, cy); ctx.rotate(beat * .015);
      ctx.strokeStyle = "rgba(230,236,213,.29)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 1.42); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 37, Math.PI * .55, Math.PI * 1.9); ctx.stroke();
      ctx.fillStyle = "rgba(232,236,215,.76)"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill(); ctx.restore();

      if (!playingRef.current) {
        const label = w < 600 ? "TAP TO SET IN MOTION" : "PRESS PLAY TO SET IN MOTION";
        ctx.font = "500 10px ui-monospace, monospace";
        const textW = ctx.measureText(label).width;
        ctx.beginPath(); ctx.roundRect(cx - textW / 2 - 13, cy + 61, textW + 26, 30, 15);
        ctx.fillStyle = "rgba(5,14,19,.76)"; ctx.fill();
        ctx.strokeStyle = "rgba(220,234,226,.16)"; ctx.stroke();
        ctx.fillStyle = "rgba(224,233,219,.72)"; ctx.fillText(label, cx - textW / 2, cy + 80);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [makeTone]);

  const liveVoices = useMemo(() => VOICES.length - muted.size, [muted]);
  const totalGates = useMemo(() => Object.values(sequences).reduce((total, steps) => total + steps.filter(Boolean).length, 0), [sequences]);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Orbit Choir home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>ORBIT CHOIR</span></a>
        <p className="tagline">Motion becomes music at the point of contact</p>
        <div className="status"><span className={playing ? "status-dot is-live" : "status-dot"} />{playing ? "MECHANISM MOVING" : "MECHANISM STILL"}</div>
      </header>

      <section id="top" className="instrument" aria-label="Collision-driven generative music instrument">
        <div className="stage-wrap">
          <canvas
            ref={canvasRef}
            className="stage"
            role="img"
            aria-label="Five objects travel on fixed paths. Select a voice, then tap its orbit to place or remove resonant gates."
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left, y = event.clientY - rect.top;
              const selectedPoints = gatePositionsRef.current[selectedVoice] ?? [];
              const nearestGate = selectedPoints.map((point, step) => ({ step, d: Math.hypot(point.x - x, point.y - y) })).sort((a, b) => a.d - b.d)[0];
              if (nearestGate && nearestGate.d < 25) { toggleStep(selectedVoice, nearestGate.step); return; }
              const nearest = VOICES.map((v) => ({ id: v.id, d: Math.hypot((positionsRef.current[v.id]?.x ?? -100) - x, (positionsRef.current[v.id]?.y ?? -100) - y) })).sort((a, b) => a.d - b.d)[0];
              if (nearest && nearest.d < 44) { toggleVoice(nearest.id); return; }
              if (!playing) void togglePlayback();
            }}
          />
          <div className="orbit-edit-label" style={{ "--edit-color": VOICES.find((voice) => voice.id === selectedVoice)?.color } as React.CSSProperties}>
            <span className="edit-dot" />
            <strong>{VOICES.find((voice) => voice.id === selectedVoice)?.name}</strong>
            <small>TAP THE 12 POINTS ON THIS ORBIT</small>
          </div>
          <div className="stage-caption"><span>{clock}</span><span>SEQUENCE BECOMES PHYSICAL SPACE</span><span>{totalGates} GATES · {liveVoices} VOICES</span></div>
        </div>

        <aside className="control-panel" aria-label="Sound controls">
          <div className="panel-head"><p>ORBIT EDITOR</p><span>SELECT A PATH</span></div>
          <div className="voice-list">
            {VOICES.map((voice) => {
              const isMuted = muted.has(voice.id);
              const isSelected = selectedVoice === voice.id;
              const gateCount = sequences[voice.id].filter(Boolean).length;
              return (
                <div key={voice.id} className={`voice-channel ${isSelected ? "selected" : ""} ${isMuted ? "muted" : ""}`} style={{ "--voice": voice.color, "--voice-rgb": voice.glow } as React.CSSProperties}>
                  <div className="voice-head">
                    <button className="voice-identity" onClick={() => setSelectedVoice(voice.id)} aria-pressed={isSelected} aria-label={`${voice.name}の軌道を編集する`}>
                      <span className="voice-orb" />
                      <span className="voice-copy"><strong>{voice.name}</strong><small>{isSelected ? "editing orbit" : voice.role}</small></span>
                    </button>
                    <span className="voice-cycle">{gateCount} GATES · {voice.period} BEATS</span>
                    <button className="voice-state" onClick={() => toggleVoice(voice.id)} aria-pressed={!isMuted}>{isMuted ? "LIFTED" : "IN PATH"}</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cause-note"><span className="cause-icon" aria-hidden="true"><i /><b /><i /></span><p><strong>SELECT → PLACE → LISTEN</strong><small>Choose a voice, then tap directly on its orbit.</small></p></div>

          <div className="sliders">
            <label><span><b>TEMPO</b><em>{tempo} BPM</em></span><input type="range" min="58" max="132" value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo" /></label>
            <label><span><b>PATH WOBBLE</b><em>{drift}%</em></span><input type="range" min="0" max="100" value={drift} onChange={(e) => setDrift(Number(e.target.value))} aria-label="Path wobble" /></label>
          </div>

          <button className={`play ${playing ? "playing" : ""}`} onClick={togglePlayback}>
            <span className="play-icon" aria-hidden="true">{playing ? <><i /><i /></> : <i />}</span>
            <span><strong>{playing ? "HOLD THE MECHANISM" : "SET IN MOTION"}</strong><small>{playing ? "motion and sound stop together" : "the first impact is close"}</small></span>
          </button>
        </aside>
      </section>

      <footer className="footer"><p>The path is the timeline. Place a gate on the orbit, and motion turns it into sound.</p><span>HEADPHONES RECOMMENDED</span></footer>
    </main>
  );
}
