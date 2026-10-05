import type { Command, RaceEvent } from '../sim/race';

/** Pit-wall orders: the button label, the call, and how a driver answers. */
export const COMMANDS: readonly { id: Command; label: string; key: string; group: 'pace' | 'stance' | 'pit'; call: string; yes: string; no: string }[] = [
  { id: 'push', label: 'Push', key: 'Q', group: 'pace', call: 'Push now, push now', yes: 'Copy. Pushing.', no: 'I am pushing!' },
  { id: 'standard', label: 'Standard', key: 'W', group: 'pace', call: 'Standard pace, bring it home', yes: 'Understood. Standard pace.', no: 'Copy.' },
  { id: 'save', label: 'Save', key: 'E', group: 'pace', call: 'Lift and coast, save the tyres', yes: 'OK, lift and coast.', no: 'Negative, I can keep this pace.' },
  { id: 'attack', label: 'Attack', key: 'A', group: 'stance', call: 'Car ahead is slower. Attack', yes: 'On it. Going for the move.', no: 'Copy.' },
  { id: 'race', label: 'Race', key: 'S', group: 'stance', call: 'You are free to race', yes: 'Copy, free to race.', no: 'Copy.' },
  { id: 'hold', label: 'Hold', key: 'D', group: 'stance', call: 'Hold position, hold position', yes: 'Holding position.', no: 'I am faster than him. Let me race!' },
  { id: 'box', label: 'Box', key: 'B', group: 'pit', call: 'Box this lap, box, box', yes: 'Box, box. Coming in.', no: 'Copy.' },
  { id: 'stayout', label: 'Stay out', key: 'N', group: 'pit', call: 'Stay out, stay out', yes: 'Staying out.', no: 'Copy.' },
];

const OVERTAKE = [
  '{a}: Thanks for holding the door, {b}.',
  '{a}: Was that a parking space, {b}? Lovely.',
  '{b}: Enjoy it, {a}. I am sending you the bill for that paint.',
  '{a}: Coming through. Mind your mirrors, {b}.',
  '{b}: Fine, {a}. I was getting bored of the view anyway.',
  '{a}: Did you leave the handbrake on, {b}?',
  '{b}: {a} drives like the hire car is due back.',
  '{a}: See you at the flag, {b}. Bring snacks.',
];
const CONTACT = [
  '{a}: {b}, the brake is the wide pedal!',
  '{b}: I had the corner, {a}. Buy a map.',
  '{a}: Lovely, {b}. Do you race or just collect bodywork?',
  '{b}: Sorry {a}, my car fancied yours.',
  '{a}: {b} must think this is the dodgems.',
  '{b}: Rubbing is racing, {a}. Mostly.',
];
const WALL = [
  '{a}: Found the wall. It was exactly where they said.',
  '{a}: That barrier came out of nowhere. Honest.',
  '{a}: Just checking the car still fits the track. It does not.',
];

function pick(lines: readonly string[], seed: number): string {
  return lines[Math.abs(Math.floor(seed)) % lines.length];
}

/** One spoken line and the car whose driver says it. */
export interface RadioLine {
  car: number;
  text: string;
}

/** Splits "{b}: words" into the speaker and the words, with driver codes filled in. */
function spoken(line: string, a: number, b: number, code: (car: number) => string): RadioLine {
  const text = line.slice(line.indexOf(':') + 2).replace('{a}', code(a)).replace('{b}', code(b));
  return { car: line.startsWith('{b}') ? b : a, text };
}

/** A comic line for an on-track incident, or null for events nobody comments on. */
export function banter(ev: RaceEvent, code: (car: number) => string, seed: number): RadioLine | null {
  if (ev.type === 'overtake') return spoken(pick(OVERTAKE, seed), ev.car, ev.passed, code);
  if (ev.type === 'contact' && ev.force > 3) return spoken(pick(CONTACT, seed), ev.a, ev.b, code);
  if (ev.type === 'wall' && ev.force > 5) return spoken(pick(WALL, seed), ev.car, ev.car, code);
  return null;
}
