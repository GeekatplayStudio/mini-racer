import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { generateBuild } from '../src/game/build';
import type { RaceSession } from '../src/game/raceSetup';
import { RaceMirror } from '../src/net/mirror';
import { planOnlineRace, sessionFromSetup } from '../src/net/onlineRace';
import type { OnlineRaceSetup } from '../src/net/protocol';
import { generateDriver } from '../src/sim/driver';
import { Race, RaceEvent, SIM_DT, Weather } from '../src/sim/race';
import { Rng } from '../src/sim/rng';
import { Snapshot, applySnapshot, encodeSnapshot } from '../src/sim/snapshot';

function setup(grid = 5, laps = 1, hazards = 0, wearScale = 1, weather: Weather = 'clear'): OnlineRaceSetup {
  const rng = new Rng(11);
  const humans = [0, 1].map((i) => ({
    build: generateBuild(rng, 3, { ...LIVERIES[i] }, `car-${i}`),
    driver: { ...generateDriver(rng, i), id: `drv-${i}` },
    owner: `team${i}`,
  }));
  const made = planOnlineRace({ trackId: BRANDS_HATCH_INDY.id, laps, grid, options: { wearScale, hazards, weather } }, humans, 77);
  if (!made) throw new Error('no setup');
  return made;
}

function pair(s: OnlineRaceSetup): [RaceSession, RaceSession] {
  // The wire carries JSON: the far side builds its race from a parsed copy.
  const a = sessionFromSetup(s, -1), b = sessionFromSetup(JSON.parse(JSON.stringify(s)) as OnlineRaceSetup, 0);
  if (!a || !b) throw new Error('no session');
  return [a, b];
}

const wire = (snap: Snapshot): Snapshot => JSON.parse(JSON.stringify(snap)) as Snapshot;

/** Everything the picture and the timing screens read, compared within the wire's resolution. */
function expectSame(a: Race, b: Race): void {
  expect(b.phase).toBe(a.phase);
  expect(b.lights).toBe(a.lights);
  expect(b.steps).toBe(a.steps);
  expect(b.fastestLapCar).toBe(a.fastestLapCar);
  expect(b.clock).toBeCloseTo(a.clock, 3);
  expect(b.time).toBeCloseTo(a.time, 3);
  if (Number.isFinite(a.fastestLap)) expect(b.fastestLap).toBeCloseTo(a.fastestLap, 2);
  else expect(b.fastestLap).toBe(Infinity);
  expect(b.order.map((c) => c.id)).toEqual(a.order.map((c) => c.id));
  // The order holds the mirror's own cars, not copies.
  b.order.forEach((c) => expect(c).toBe(b.cars[c.id]));

  a.cars.forEach((ca, i) => {
    const cb = b.cars[i];
    const sa = ca.state, sb = cb.state;
    for (const key of ['x', 'y', 'vx', 'vy', 'throttle', 'brake', 'slideFront', 'slideRear'] as const) expect(Math.abs(sb[key] - sa[key]), key).toBeLessThanOrEqual(0.0051);
    for (const key of ['heading', 'yawRate', 'steerAngle', 'fuel', 'tyreWear', 'damage'] as const) expect(Math.abs(sb[key] - sa[key]), key).toBeLessThanOrEqual(0.00051);
    for (const key of ['ax', 'ay'] as const) expect(Math.abs(sb[key] - sa[key]), key).toBeLessThanOrEqual(0.051);
    expect(Math.abs(sb.rpm - sa.rpm)).toBeLessThanOrEqual(0.51);
    expect(sb.gear).toBe(sa.gear);
    for (const key of ['surface', 'position', 'crossings', 'finished', 'retired', 'retireReason', 'parked', 'pitMode', 'pitRequested', 'pitPhase', 'pitStops', 'pace', 'stance', 'contacts'] as const) {
      expect(cb[key], key).toBe(ca[key]);
    }
    for (const key of ['progress', 'lapStart', 'lastLap', 'finishTime', 'pitTimer', 'pitSaving', 'dirt'] as const) expect(Math.abs(cb[key] - ca[key]), key).toBeLessThanOrEqual(0.0051);
    if (Number.isFinite(ca.bestLap)) expect(cb.bestLap).toBeCloseTo(ca.bestLap, 2);
    else expect(cb.bestLap).toBe(Infinity);
    ca.dents.forEach((d, z) => expect(Math.abs(cb.dents[z] - d)).toBeLessThanOrEqual(0.0051));
    if (!ca.parked) {
      expect(cb.loc.index).toBe(a.track.locate(sb.x, sb.y, -1).index);
      expect(Math.abs(cb.loc.d - ca.loc.d)).toBeLessThan(0.05);
    } else {
      expect(cb.loc.d).toBe(ca.loc.d);
    }
    expect(b.lapsDone(cb)).toBe(a.lapsDone(ca));
    expect(Math.abs(b.fuelLapsLeft(cb) - a.fuelLapsLeft(ca))).toBeLessThan(0.01 + 0.002 * a.fuelLapsLeft(ca));
  });

  expect(b.wetness).toBeCloseTo(a.wetness, 2);
  expect(b.puddles.length).toBe(a.puddles.length);
  a.puddles.forEach((pa, i) => {
    const pb = b.puddles[i];
    expect(pb.id).toBe(pa.id);
    expect(pb.kind).toBe(pa.kind);
    expect(pb.x).toBe(pa.x);
    expect(pb.y).toBe(pa.y);
    expect(Math.abs(pb.radius - pa.radius)).toBeLessThanOrEqual(0.0051);
  });

  expect(b.hazards.length).toBe(a.hazards.length);
  a.hazards.forEach((ha, i) => {
    const hb = b.hazards[i];
    expect(hb.id).toBe(ha.id);
    expect(hb.kind).toBe(ha.kind);
    expect(hb.solid).toBe(ha.solid);
    expect(hb.tint).toBe(ha.tint);
    for (const key of ['s', 'd', 'x', 'y', 'radius', 'drift'] as const) expect(Math.abs(hb[key] - ha[key]), key).toBeLessThanOrEqual(0.0051);
    expect(Math.abs(hb.life - ha.life)).toBeLessThanOrEqual(0.051);
    expect(hb.view.obstacle).toBe(true);
    expect(hb.view.soft).toBe(ha.view.soft);
    expect(hb.view.state.x).toBe(hb.x);
    expect(hb.view.loc.index).toBe(ha.view.loc.index);
    expect(hb.view.spec.length).toBeCloseTo(ha.view.spec.length, 2);
  });
}

describe('Race snapshots', () => {
  it('a full snapshot reproduces the race in a second instance', () => {
    const [a, b] = pair(setup());
    for (let i = 0; i < 20 * 240; i++) a.race.step();
    a.race.events.length = 0;
    applySnapshot(b.race, wire(encodeSnapshot(a.race, true)));
    expectSame(a.race, b.race);
    expect(b.race.cars.some((c) => Math.hypot(c.state.vx, c.state.vy) > 20)).toBe(true);
  });

  it('follows a whole race through rain, pit stops, hazards, retirements and the finish', () => {
    // Heavy wear, many hazards and rain bring every kind of state into a short race.
    const [a, b] = pair(setup(6, 3, 18, 15, 'rain'));
    expect(a.race.puddles.length).toBeGreaterThan(0);
    const sent: RaceEvent[] = [];
    let pending: RaceEvent[] = [];
    let n = 0;
    let sawHazard = false, sawPit = false, checked = 0;
    // Read through a function: stepping changes the phase behind the type checker's back.
    const over = (): boolean => a.race.phase === 'finished';
    while (a.race.phase !== 'finished' && a.race.steps < 900 * 240) {
      a.race.step();
      if (a.race.events.length) {
        pending.push(...a.race.events);
        a.race.events.length = 0;
      }
      if (a.race.steps % 12 !== 0 && !over()) continue;
      const full = n++ % 5 === 0 || pending.length > 0 || over();
      sent.push(...pending);
      applySnapshot(b.race, wire(encodeSnapshot(a.race, full, pending)));
      pending = [];
      if (full) {
        // Fast and slow values are both fresh: the two races must agree.
        if (checked++ % 20 === 0 || over()) expectSame(a.race, b.race);
        sawHazard ||= b.race.hazards.length > 0;
        sawPit ||= b.race.cars.some((c) => c.pitPhase !== 0);
      }
    }
    expect(a.race.phase).toBe('finished');
    expectSame(a.race, b.race);
    expect(sawHazard).toBe(true);
    expect(sawPit).toBe(true);
    expect(b.race.order[0].finished).toBe(true);
    // Events ride along and land in the mirror's own queue.
    expect(b.race.events).toEqual(JSON.parse(JSON.stringify(sent)));
    expect(sent.some((e) => e.type === 'end')).toBe(true);
  });

  it('keeps hazard objects across snapshots and drops the ones that are gone', () => {
    const [a, b] = pair(setup(4, 4, 18, 1));
    while (a.race.hazards.length < 2 && a.race.steps < 300 * 240) a.race.step();
    expect(a.race.hazards.length).toBeGreaterThanOrEqual(2);
    applySnapshot(b.race, wire(encodeSnapshot(a.race, true)));
    const first = b.race.hazards[0];
    const kept = a.race.hazards[0].id;
    a.race.hazards.splice(1);
    applySnapshot(b.race, wire(encodeSnapshot(a.race, true)));
    expect(b.race.hazards.length).toBe(1);
    expect(b.race.hazards[0]).toBe(first);
    expect(first.id).toBe(kept);
    // A snapshot without the slow part leaves the hazards alone.
    applySnapshot(b.race, wire(encodeSnapshot(a.race, false)));
    expect(b.race.hazards.length).toBe(1);
  });

  it('never steps the mirror race', () => {
    const [a, b] = pair(setup());
    for (let i = 0; i < 2400; i++) a.race.step();
    applySnapshot(b.race, wire(encodeSnapshot(a.race, true)));
    expect(b.race.steps).toBe(a.race.steps);
    expect(encodeSnapshot(b.race, true)).toEqual(encodeSnapshot(a.race, true));
  });
});

describe('Race mirror', () => {
  it('shows smooth motion close to the true positions between snapshots', () => {
    const [a, b] = pair(setup(4, 2));
    const mirror = new RaceMirror(b.race);
    const frame = 1 / 60;
    let sim = 0;
    let worst = 0, worstJump = 0;
    const last = b.race.cars.map((c) => ({ x: c.state.x, y: c.state.y }));
    // Forty seconds: the start, the first corners and a good part of a lap.
    for (let f = 0; f < 40 * 60; f++) {
      sim += frame;
      while (sim >= SIM_DT) {
        a.race.step();
        sim -= SIM_DT;
        // Twenty snapshots a second, as the server sends them.
        if (a.race.steps % 12 === 0) mirror.apply(wire(encodeSnapshot(a.race, a.race.steps % 60 === 0)));
      }
      a.race.events.length = 0;
      mirror.advance(frame);
      b.race.cars.forEach((cb, i) => {
        const ca = a.race.cars[i];
        const speed = Math.hypot(ca.state.vx, ca.state.vy);
        worst = Math.max(worst, Math.hypot(cb.state.x - ca.state.x, cb.state.y - ca.state.y));
        // No frame moves a car much further than its speed allows.
        const moved = Math.hypot(cb.state.x - last[i].x, cb.state.y - last[i].y);
        worstJump = Math.max(worstJump, moved - speed * frame);
        last[i].x = cb.state.x;
        last[i].y = cb.state.y;
      });
    }
    expect(a.race.phase).toBe('racing');
    expect(a.race.cars.some((c) => Math.hypot(c.state.vx, c.state.vy) > 30)).toBe(true);
    expect(worst).toBeLessThan(1.5);
    expect(worstJump).toBeLessThan(0.35);
    expect(b.race.time).toBeGreaterThan(30);
  });

  it('holds the cars when the snapshots stop', () => {
    const [a, b] = pair(setup(3, 2));
    const mirror = new RaceMirror(b.race);
    for (let i = 0; i < 20 * 240; i++) {
      a.race.step();
      if (a.race.steps % 12 === 0) {
        mirror.apply(wire(encodeSnapshot(a.race, true)));
        for (let k = 0; k < 3; k++) mirror.advance(1 / 60);
      }
    }
    for (let k = 0; k < 120; k++) mirror.advance(1 / 60);
    const before = b.race.cars.map((c) => c.state.x);
    for (let k = 0; k < 120; k++) mirror.advance(1 / 60);
    b.race.cars.forEach((c, i) => expect(Math.abs(c.state.x - before[i])).toBeLessThan(0.05));
  });
});
