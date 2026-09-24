// Synthesised sound effects and a tiny step-sequencer BGM (Web Audio, no files).
let ac = null;
let master = null;
let noiseBuf = null;
let muted = false;
let bgmTimer = null;

function ensure() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = 0.35;
  master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

export function unlockAudio() {
  const a = ensure();
  if (a && a.state === 'suspended') a.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

function tone({ type = 'square', f0 = 440, f1 = f0, dur = 0.1, vol = 0.3, at = 0 }) {
  if (!ensure() || muted) return;
  const t = ac.currentTime + at;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.4, f0 = 3000, f1 = 300, q = 0.7, at = 0 }) {
  if (!ensure() || muted) return;
  const t = ac.currentTime + at;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  pistol: () => { tone({ f0: 900, f1: 180, dur: 0.07, vol: 0.18 }); noise({ dur: 0.05, vol: 0.2, f0: 5000, f1: 1000 }); },
  rifle: () => { tone({ f0: 700, f1: 120, dur: 0.06, vol: 0.14 }); noise({ dur: 0.06, vol: 0.25, f0: 4000, f1: 600 }); },
  shotgun: () => { noise({ dur: 0.3, vol: 0.6, f0: 2500, f1: 120 }); tone({ type: 'sawtooth', f0: 180, f1: 50, dur: 0.2, vol: 0.2 }); },
  rocket: () => { tone({ type: 'sawtooth', f0: 220, f1: 70, dur: 0.35, vol: 0.18 }); noise({ dur: 0.35, vol: 0.2, f0: 1500, f1: 400 }); },
  vulcan: () => { tone({ f0: 500, f1: 150, dur: 0.05, vol: 0.12 }); noise({ dur: 0.04, vol: 0.18, f0: 3000, f1: 800 }); },
  cannon: () => { noise({ dur: 0.4, vol: 0.5, f0: 1200, f1: 80 }); tone({ type: 'triangle', f0: 120, f1: 40, dur: 0.3, vol: 0.4 }); },
  enemyShot: () => { tone({ f0: 420, f1: 110, dur: 0.08, vol: 0.1 }); },
  boom: () => { noise({ dur: 0.6, vol: 0.6, f0: 1800, f1: 60 }); tone({ type: 'triangle', f0: 110, f1: 30, dur: 0.5, vol: 0.4 }); },
  bigBoom: () => { noise({ dur: 1.2, vol: 0.8, f0: 1500, f1: 40 }); tone({ type: 'triangle', f0: 90, f1: 25, dur: 1.0, vol: 0.5 }); },
  hit: () => { tone({ f0: 1400, f1: 900, dur: 0.04, vol: 0.08 }); },
  clank: () => { tone({ type: 'square', f0: 2200, f1: 1600, dur: 0.05, vol: 0.06 }); },
  knife: () => { noise({ dur: 0.1, vol: 0.3, f0: 8000, f1: 2000, q: 3 }); },
  throw: () => { noise({ dur: 0.15, vol: 0.15, f0: 2000, f1: 600, q: 2 }); },
  pickup: () => { [660, 880, 1320].forEach((f, i) => tone({ f0: f, dur: 0.07, vol: 0.15, at: i * 0.06 })); },
  weapon: () => { [440, 660, 880, 1320].forEach((f, i) => tone({ f0: f, dur: 0.09, vol: 0.17, at: i * 0.07 })); },
  scream: () => { const b = 380 + Math.random() * 200; tone({ type: 'sawtooth', f0: b, f1: b * 0.4, dur: 0.35, vol: 0.12 }); },
  die: () => { tone({ type: 'sawtooth', f0: 600, f1: 90, dur: 0.6, vol: 0.2 }); },
  thanks: () => { tone({ f0: 523, dur: 0.1, vol: 0.14 }); tone({ f0: 784, dur: 0.16, vol: 0.14, at: 0.1 }); },
  enter: () => { tone({ type: 'triangle', f0: 200, f1: 600, dur: 0.2, vol: 0.25 }); },
  alarm: () => { for (let i = 0; i < 4; i++) tone({ type: 'square', f0: 880, f1: 440, dur: 0.25, vol: 0.12, at: i * 0.3 }); },
  start: () => { [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 0.14, vol: 0.2, at: i * 0.12 })); },
};

// ---- BGM: 16-step patterns. Notes are MIDI numbers, 0 = rest.
const PATTERNS = {
  stage: {
    bpm: 150,
    bass: [45, 0, 45, 45, 0, 45, 48, 0, 43, 0, 43, 43, 0, 43, 47, 0, 41, 0, 41, 41, 0, 41, 45, 0, 43, 0, 43, 45, 47, 0, 48, 0],
    lead: [69, 0, 72, 0, 74, 0, 72, 69, 67, 0, 0, 0, 71, 0, 67, 0, 65, 0, 69, 0, 72, 0, 69, 65, 67, 0, 71, 0, 74, 72, 71, 0],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0],
  },
  boss: {
    bpm: 170,
    bass: [40, 40, 0, 40, 43, 0, 40, 46, 40, 40, 0, 40, 43, 0, 46, 45, 38, 38, 0, 38, 41, 0, 38, 44, 38, 38, 0, 38, 41, 43, 44, 45],
    lead: [64, 0, 64, 67, 0, 70, 0, 69, 0, 0, 64, 0, 0, 0, 0, 0, 62, 0, 62, 65, 0, 68, 0, 67, 0, 0, 62, 0, 70, 69, 68, 67],
    kick: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  },
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function playBgm(name) {
  stopBgm();
  if (!ensure()) return;
  const p = PATTERNS[name];
  const step = 60 / p.bpm / 4;
  let i = 0;
  let next = ac.currentTime + 0.05;
  bgmTimer = setInterval(() => {
    while (next < ac.currentTime + 0.2) {
      const at = next - ac.currentTime;
      if (!muted) {
        const b = p.bass[i % p.bass.length];
        if (b) tone({ type: 'triangle', f0: midi(b), dur: step * 1.8, vol: 0.22, at });
        const l = p.lead[i % p.lead.length];
        if (l) tone({ type: 'square', f0: midi(l), dur: step * 1.6, vol: 0.05, at });
        if (p.kick[i % 16]) tone({ type: 'sine', f0: 150, f1: 40, dur: 0.12, vol: 0.35, at });
        if (p.snare[i % 16]) noise({ dur: 0.1, vol: 0.12, f0: 6000, f1: 1500, at });
      }
      i += 1;
      next += step;
    }
  }, 50);
}

export function stopBgm() {
  if (bgmTimer) clearInterval(bgmTimer);
  bgmTimer = null;
}
