// Synthesized sounds (Web Audio API). No audio files are shipped: every sound is built from noise bursts and
// oscillators shaped with filters and fast envelopes. These are neutral mechanical sounds, not music.

import type { TickSoundId } from "../settings";
import { randomInt, randomRange } from "./random";

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
	let buf = noiseCache.get(ctx);
	if (!buf) {
		const len = Math.floor(ctx.sampleRate * 0.5);
		buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		// White noise. Math-quality randomness is fine here, but keep everything in random.ts.
		for (let i = 0; i < len; i++) data[i] = randomRange(-1, 1);
		noiseCache.set(ctx, buf);
	}
	return buf;
}

/** ±pct random variation factor. */
function vary(pct: number): number {
	return 1 + randomRange(-pct, pct);
}

interface NoiseOpts {
	at: number;
	dur: number;
	gain: number;
	filter: BiquadFilterType;
	freq: number;
	q?: number;
	attack?: number;
	filter2?: { type: BiquadFilterType; freq: number; q?: number };
}

function noiseHit(ctx: BaseAudioContext, out: AudioNode, o: NoiseOpts): void {
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer(ctx);
	const f = ctx.createBiquadFilter();
	f.type = o.filter;
	f.frequency.value = o.freq;
	f.Q.value = o.q ?? 1;
	const g = ctx.createGain();
	const attack = o.attack ?? 0.001;
	g.gain.setValueAtTime(0.0001, o.at);
	g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, o.at + attack + o.dur);
	let node: AudioNode = f;
	src.connect(f);
	if (o.filter2) {
		const f2 = ctx.createBiquadFilter();
		f2.type = o.filter2.type;
		f2.frequency.value = o.filter2.freq;
		f2.Q.value = o.filter2.q ?? 1;
		f.connect(f2);
		node = f2;
	}
	node.connect(g);
	g.connect(out);
	const offset = randomRange(0, 0.4);
	src.start(o.at, offset, attack + o.dur + 0.02);
}

interface ToneOpts {
	at: number;
	dur: number;
	gain: number;
	freq: number;
	type?: OscillatorType;
	endFreq?: number;
	attack?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): void {
	const osc = ctx.createOscillator();
	osc.type = o.type ?? "sine";
	osc.frequency.setValueAtTime(o.freq, o.at);
	if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(o.endFreq, o.at + o.dur);
	const g = ctx.createGain();
	const attack = o.attack ?? 0.001;
	g.gain.setValueAtTime(0.0001, o.at);
	g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, o.at + attack + o.dur);
	osc.connect(g);
	g.connect(out);
	osc.start(o.at);
	osc.stop(o.at + attack + o.dur + 0.03);
}

/** One tick of a built-in tick sound. `pitch` ≈ 1 ± 3–5 %. */
export function playTick(ctx: BaseAudioContext, out: AudioNode, id: TickSoundId, at: number): void {
	const p = vary(0.04);
	switch (id) {
		case 1: // Wooden clicker — dry, short, mid-low wooden knock.
			noiseHit(ctx, out, { at, dur: 0.035, gain: 0.9, filter: "bandpass", freq: 900 * p, q: 4 });
			tone(ctx, out, { at, dur: 0.045, gain: 0.55, freq: 320 * p, endFreq: 240 * p, type: "triangle" });
			break;
		case 2: // Plastic flapper — bright, slightly snappy prize-wheel flap.
			noiseHit(ctx, out, {
				at, dur: 0.018, gain: 0.8, filter: "highpass", freq: 1800 * p, q: 0.7,
				filter2: { type: "peaking", freq: 3200 * p, q: 2 },
			});
			tone(ctx, out, { at, dur: 0.012, gain: 0.35, freq: 1500 * p, endFreq: 900 * p, type: "square" });
			break;
		case 3: // Metal ratchet — thin, higher-pitched metallic tick.
			tone(ctx, out, { at, dur: 0.03, gain: 0.25, freq: 4300 * p, type: "sine" });
			tone(ctx, out, { at, dur: 0.022, gain: 0.18, freq: 6150 * p, type: "sine" });
			noiseHit(ctx, out, { at, dur: 0.01, gain: 0.5, filter: "highpass", freq: 5200 * p, q: 1 });
			break;
		case 4: // Soft tick — muted, gentle.
			noiseHit(ctx, out, { at, dur: 0.025, gain: 0.3, filter: "lowpass", freq: 1300 * p, q: 0.8, attack: 0.003 });
			tone(ctx, out, { at, dur: 0.02, gain: 0.12, freq: 520 * p, type: "sine", attack: 0.002 });
			break;
		case 5: // Heavy mechanical clack — deeper, chunkier, tiny tail.
			noiseHit(ctx, out, { at, dur: 0.06, gain: 1, filter: "bandpass", freq: 420 * p, q: 1.6 });
			tone(ctx, out, { at, dur: 0.09, gain: 0.7, freq: 150 * p, endFreq: 70 * p, type: "triangle" });
			noiseHit(ctx, out, { at: at + 0.004, dur: 0.012, gain: 0.4, filter: "highpass", freq: 2500 * p });
			break;
	}
}

/** Dice rattle: a burst of short filtered-noise clicks with randomized timing. */
export function playDiceRattle(ctx: BaseAudioContext, out: AudioNode, at: number, diceCount: number): void {
	const clicks = Math.min(10, 4 + Math.round(diceCount * 1.2) + randomInt(0, 2));
	const span = 0.22 + Math.min(0.2, diceCount * 0.02);
	for (let i = 0; i < clicks; i++) {
		const t = at + randomRange(0, span);
		const p = vary(0.05);
		noiseHit(ctx, out, {
			at: t, dur: randomRange(0.008, 0.02), gain: randomRange(0.35, 0.8),
			filter: "bandpass", freq: randomRange(1800, 3800) * p, q: 3,
		});
		tone(ctx, out, { at: t, dur: 0.012, gain: 0.08, freq: randomRange(900, 1400) * p, type: "triangle" });
	}
}

/** Dice land: a soft thud per die, slightly staggered. */
export function playDiceLand(ctx: BaseAudioContext, out: AudioNode, at: number, diceCount: number): void {
	const n = Math.max(1, Math.min(8, diceCount));
	for (let i = 0; i < n; i++) {
		const t = at + i * randomRange(0.03, 0.06);
		const p = vary(0.05);
		noiseHit(ctx, out, { at: t, dur: 0.07, gain: 0.7, filter: "lowpass", freq: 380 * p, q: 0.9 });
		tone(ctx, out, { at: t, dur: 0.08, gain: 0.45, freq: 110 * p, endFreq: 65 * p, type: "sine" });
		noiseHit(ctx, out, { at: t, dur: 0.01, gain: 0.2, filter: "bandpass", freq: 2200 * p, q: 2 });
	}
}

/** Bell-like metallic partials (inharmonic). */
function metal(ctx: BaseAudioContext, out: AudioNode, at: number, base: number, gain: number, dur: number): void {
	const partials = [1, 1.51, 2.09, 2.76];
	partials.forEach((m, i) => {
		tone(ctx, out, { at, dur: dur * (1 - i * 0.18), gain: gain / (i + 1.3), freq: base * m, type: "sine" });
	});
}

/** Coin flip: short metallic "ting" with fast ring-out at launch. */
export function playCoinFlip(ctx: BaseAudioContext, out: AudioNode, at: number): void {
	const p = vary(0.05);
	noiseHit(ctx, out, { at, dur: 0.008, gain: 0.5, filter: "highpass", freq: 4000, q: 1 });
	metal(ctx, out, at, 2900 * p, 0.5, 0.28);
}

/** Coin land: two or three quick metallic clinks, decaying. */
export function playCoinLand(ctx: BaseAudioContext, out: AudioNode, at: number): void {
	const clinks = randomInt(2, 3);
	let t = at;
	let gain = 0.55;
	for (let i = 0; i < clinks; i++) {
		const p = vary(0.05);
		noiseHit(ctx, out, { at: t, dur: 0.006, gain: gain * 0.8, filter: "highpass", freq: 3500, q: 1 });
		metal(ctx, out, t, 2300 * p, gain, 0.12 + i * 0.03);
		t += randomRange(0.07, 0.12) * (1 - i * 0.25);
		gain *= 0.55;
	}
}
