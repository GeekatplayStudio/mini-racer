import { getPart } from '../data/parts';
import { clamp } from '../sim/math';
import type { CarBuild } from './build';

/**
 * How an engine sounds, from its layout and exhaust. The sound code turns
 * this into a synthesised note; the simulation never sees it.
 */
export interface EngineVoice {
  /** What the player would call it, e.g. "V10". */
  label: string;
  /** Cylinders: firing pulses per two turns of the crank set the pitch. */
  cylinders: number;
  /** Uneven firing, 0..1: the burble of a cross-plane V8 or a flat-six. */
  lump: number;
  /** Hard top end, 0..1: the shriek of a V10 or a flat-plane V8. */
  rasp: number;
  /** Turbo whistle and the muffling turbines give the exhaust, 0 (none) to 1. */
  turbo: number;
  /** How open the exhaust is, 0 (silenced) to 1 (straight through). */
  open: number;
  /** Size of the engine, 0 (small) to 1 (6 litres and up): weight in the low notes. */
  size: number;
  /** Pitch ratio near 1, so two cars with the same engine still sound apart. */
  tune: number;
}

type Character = Pick<EngineVoice, 'label' | 'cylinders' | 'lump' | 'rasp' | 'turbo'>;

const FLAT_SIX: Character = { label: 'Flat-six', cylinders: 6, lump: 0.4, rasp: 0.7, turbo: 0 };
const INLINE_SIX: Character = { label: 'Inline-six turbo', cylinders: 6, lump: 0.05, rasp: 0.35, turbo: 1 };
const V6_TURBO: Character = { label: 'V6 turbo', cylinders: 6, lump: 0.15, rasp: 0.65, turbo: 1 };
/** Cross-plane crank: the classic uneven V8 burble. */
const V8_CROSS: Character = { label: 'V8', cylinders: 8, lump: 0.9, rasp: 0.2, turbo: 0 };
const V8_CROSS_TURBO: Character = { label: 'V8 biturbo', cylinders: 8, lump: 0.65, rasp: 0.3, turbo: 1 };
/** Flat-plane crank: even firing, a harder and higher edge. */
const V8_FLAT_TURBO: Character = { label: 'Flat-plane V8 turbo', cylinders: 8, lump: 0.1, rasp: 0.55, turbo: 1 };
const V10: Character = { label: 'V10', cylinders: 10, lump: 0.25, rasp: 0.85, turbo: 0 };

/** Engine families whose V8s have flat-plane cranks. */
const FLAT_PLANE = new Set(['ferrari', 'mclaren']);

/** Engine sound by the shape variant the engine parts use for their model. */
function characterOfEngine(engineId: string | undefined): { character: Character; litres: number } {
  const part = engineId ? getPart(engineId) : undefined;
  const turbo = part?.fx.turbo ?? false;
  const litres = Number(/(\d+(?:\.\d+)?)\s*L\b/.exec(part?.name ?? '')?.[1] ?? 4);
  let character: Character;
  switch (part?.look.style) {
    case 0:
      character = FLAT_SIX;
      break;
    case 1:
      character = INLINE_SIX;
      break;
    case 3:
      character = V6_TURBO;
      break;
    case 4:
      character = V10;
      break;
    default:
      character = !turbo ? V8_CROSS : part?.fits?.some((f) => FLAT_PLANE.has(f)) ? V8_FLAT_TURBO : V8_CROSS_TURBO;
  }
  return { character, litres };
}

/** Exhaust openness by exhaust part; louder and rawer up the range. */
const EXHAUST_OPEN: Record<string, number> = {
  'ex-steel': 0.2,
  'ex-supersprint': 0.45,
  'ex-capristo': 0.7,
  'ex-akrapovic': 0.75,
  'ex-inconel': 0.9,
};

/** The engines of the ready-made cars used in quick races and the title demo. */
const MODEL_ENGINES: Record<string, { character: Character; litres: number }> = {
  'porsche-911-gt3-r-992': { character: FLAT_SIX, litres: 4.2 },
  'bmw-m4-gt3': { character: INLINE_SIX, litres: 3 },
  'mercedes-amg-gt3-evo': { character: V8_CROSS, litres: 6.2 },
  'ferrari-296-gt3': { character: V6_TURBO, litres: 3 },
  'audi-r8-lms-gt3-evo2': { character: V10, litres: 5.2 },
  'lamborghini-huracan-gt3-evo2': { character: V10, litres: 5.2 },
  'mclaren-720s-gt3-evo': { character: V8_FLAT_TURBO, litres: 4 },
  'aston-martin-vantage-gt3': { character: V8_CROSS_TURBO, litres: 4 },
};

/** A stable number in [0, 1) from a string. */
function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  // Mix the bits so names one letter apart land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * Builds a voice from an engine character. `who` picks the small differences
 * every car has: tolerances, wear, how the exhaust was welded.
 */
function voiceOf(base: { character: Character; litres: number }, open: number, who: string): EngineVoice {
  const r = hash01(who);
  const r2 = hash01(`${who}/2`);
  const c = base.character;
  return {
    ...c,
    lump: clamp(c.lump + (r2 - 0.5) * 0.16, 0, 1),
    rasp: clamp(c.rasp + (r - 0.5) * 0.16, 0, 1),
    open,
    size: clamp((base.litres - 2.5) / 3.7, 0, 1),
    tune: 1 + (r - 0.5) * 0.06,
  };
}

/** The voice of a car the player or a rival team built. */
export function voiceForBuild(build: CarBuild, who = build.id): EngineVoice {
  const exhaust = build.parts.exhaust?.part;
  return voiceOf(characterOfEngine(build.parts.engine?.part), exhaust ? EXHAUST_OPEN[exhaust] ?? 0.5 : 0.5, who);
}

/** The voice of a ready-made car; `who` tells apart two of the same model on the grid. */
export function voiceForModel(specId: string, who: string): EngineVoice {
  const known = MODEL_ENGINES[specId] ?? { character: V8_CROSS_TURBO, litres: 4 };
  return voiceOf(known, 0.6, who);
}
