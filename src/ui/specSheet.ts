import type { CarStats, DerivedCar } from '../game/build';
import { h, lapText, money } from './dom';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Six headline scores, 0-100, for the overall picture of a car. */
export function categoryScores(s: CarStats): [string, number][] {
  return [
    ['Acceleration', clamp01((4.0 - s.accel) / (4.0 - 1.9))],
    ['Top speed', clamp01((s.topSpeedKmh - 240) / (295 - 240))],
    ['Braking', clamp01((106 - s.braking) / (106 - 72))],
    ['Cornering', clamp01((s.gripG - 1.4) / (2.0 - 1.4))],
    ['Aero efficiency', clamp01((s.downforceKg / s.dragCdA - 180) / (640 - 180))],
    ['Reliability', clamp01((s.reliability - 0.3) / 0.6)],
  ].map(([label, v]) => [label as string, Math.round((v as number) * 100)]);
}

export function ratingGrade(rating: number): string {
  return rating >= 90 ? 'S' : rating >= 75 ? 'A' : rating >= 55 ? 'B' : rating >= 35 ? 'C' : 'D';
}

/** The whole car on one sheet: overall rating, category bars and every figure. */
export function specSheet(d: DerivedCar, title: string): HTMLElement {
  const s = d.stats;
  if (!s || !d.spec) {
    return h('div', { class: 'sheet' }, h('div', { class: 'dim', text: 'Fit an engine, gearbox and tyres to see the spec sheet.' }));
  }
  const spec = d.spec;
  const scores = h('div', { class: 'sheet-scores' });
  for (const [label, value] of categoryScores(s)) {
    scores.append(h('div', { class: 'score' },
      h('span', { text: label }),
      h('div', { class: 'meter' }, h('i', { style: { width: `${Math.max(3, value)}%` } })),
      h('span', { class: 'val', text: String(value) }),
    ));
  }
  const rows: [string, string][] = [
    ['Power', `${s.powerHp.toFixed(0)} hp`],
    ['Torque', `${s.torqueNm.toFixed(0)} Nm`],
    ['Rev limit', `${s.revLimit.toFixed(0)} rpm`],
    ['Weight', `${s.massKg.toFixed(0)} kg`],
    ['Power to weight', `${s.powerToWeight.toFixed(0)} hp/t`],
    ['Weight on front', `${(s.frontWeight * 100).toFixed(0)}%`],
    ['Wheelbase', `${spec.wheelbase.toFixed(3)} m`],
    ['0-100 km/h', `${s.accel.toFixed(2)} s`],
    ['Top speed', `${s.topSpeedKmh.toFixed(0)} km/h`],
    ['200-0 km/h', `${s.braking.toFixed(1)} m`],
    ['Cornering at 120', `${s.gripG.toFixed(2)} g`],
    ['Downforce at 200', `${s.downforceKg.toFixed(0)} kg`],
    ['Drag area', s.dragCdA.toFixed(3)],
    ['Aero on front', `${(s.aeroFront * 100).toFixed(0)}%`],
    ['Brake balance', `${(spec.brakeBias * 100).toFixed(0)}% front`],
    ['Shift time', `${s.shiftMs.toFixed(0)} ms`],
    ['Driveline loss', `${((1 - spec.drivelineEfficiency) * 100).toFixed(1)}%`],
    ['Fuel tank', `${s.fuelKg.toFixed(0)} kg`],
    ['Fuel per lap', `${s.fuelPerLap.toFixed(2)} kg`],
    ['Range on start fuel', `${s.fuelLaps.toFixed(0)} laps`],
    ['Tyre life', `${s.tyreLaps.toFixed(0)} laps`],
    ['Traction control', `${(spec.tractionControl * 100).toFixed(0)}%`],
    ['ABS', `${(spec.abs * 100).toFixed(0)}%`],
    ['Reliability', `${(s.reliability * 100).toFixed(0)}%`],
    ['Safety', s.safety.toFixed(1)],
    ['Comfort', `${(s.comfort * 100).toFixed(0)}`],
    ['Pit stop saving', `${s.pitSaving.toFixed(1)} s`],
    ['Lap estimate', lapText(s.lapTime)],
    ['Value', money(d.value)],
  ];
  const grid = h('div', { class: 'sheet-grid' });
  for (const [k, v] of rows) grid.append(h('span', { class: 'dim', text: k }), h('span', { text: v }));
  const notes = h('div', { class: 'sheet-notes' }, ...d.notes.map((n) => h('div', { class: 'bad', text: n })));
  return h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('div', { class: 'rating' }, h('b', { text: String(s.rating) }), h('span', { text: `Class ${ratingGrade(s.rating)}` })),
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { class: 'gold', text: title }), scores),
    ),
    grid,
    notes,
  );
}
