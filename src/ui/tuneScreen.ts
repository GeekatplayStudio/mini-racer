import { alias } from '../data/naming';
import { getPart } from '../data/parts';
import { CarBuild, DerivedCar, chassisName, deriveCar } from '../game/build';
import {
  AID_LEVELS,
  ECU_LIMITS,
  ECU_POINTS,
  EcuMap,
  RATED_BOOST,
  SETUP_LIMITS,
  Setup,
  bestAdvance,
  revLimitRange,
  rpmAtPoint,
  safeMap,
} from '../game/ecu';
import { DYNO_FEE, dynoSession } from '../game/profile';
import { engineTorque } from '../sim/car';
import type { App, Screen } from './appTypes';
import { h, hexColor, lapText, money } from './dom';
import { specSheet } from './specSheet';

type Row = 'ign' | 'lambda' | 'boost';

/** Draws torque and power against engine speed, with the safe map as a ghost. */
function drawDyno(canvas: HTMLCanvasElement, tuned: DerivedCar, safe: DerivedCar): void {
  const W = 520, H = 250;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx || !tuned.spec || !safe.spec) return;
  const pad = { l: 34, r: 34, t: 10, b: 22 };
  const maxRpm = Math.max(tuned.spec.engine.redline, safe.spec.engine.redline);
  const minRpm = tuned.spec.engine.idle;
  const curve = (d: DerivedCar): { rpm: number; nm: number; hp: number }[] => {
    const out = [];
    for (let rpm = minRpm; rpm <= d.spec!.engine.redline; rpm += 100) {
      const nm = engineTorque(d.spec!, rpm);
      out.push({ rpm, nm, hp: (nm * rpm * 2 * Math.PI) / 60000 * 1.341 });
    }
    return out;
  };
  const a = curve(tuned), b = curve(safe);
  const maxHp = Math.ceil(Math.max(...a.map((p) => p.hp), ...b.map((p) => p.hp)) / 100) * 100;
  const maxNm = Math.ceil(Math.max(...a.map((p) => p.nm), ...b.map((p) => p.nm)) / 100) * 100;
  const x = (rpm: number): number => pad.l + ((rpm - minRpm) / (maxRpm - minRpm)) * (W - pad.l - pad.r);
  const y = (v: number, max: number): number => H - pad.b - (v / max) * (H - pad.t - pad.b);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0f1e';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '600 14px "Chakra Petch", sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + ((H - pad.t - pad.b) * i) / 4;
    ctx.strokeStyle = '#262b52';
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(W - pad.r, gy);
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round((maxHp * (4 - i)) / 4)), pad.l - 4, gy + 5);
    ctx.fillStyle = '#3fe0ff';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round((maxNm * (4 - i)) / 4)), W - pad.r + 4, gy + 5);
  }
  ctx.fillStyle = '#8a90b4';
  ctx.textAlign = 'center';
  for (let rpm = Math.ceil(minRpm / 1000) * 1000; rpm <= maxRpm; rpm += 1000) {
    ctx.fillText(String(rpm / 1000), x(rpm), H - 6);
    ctx.strokeStyle = '#1c2040';
    ctx.beginPath();
    ctx.moveTo(x(rpm), pad.t);
    ctx.lineTo(x(rpm), H - pad.b);
    ctx.stroke();
  }
  const line = (pts: { rpm: number; nm: number; hp: number }[], key: 'nm' | 'hp', max: number, color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.rpm), y(p[key], max)) : ctx.lineTo(x(p.rpm), y(p[key], max))));
    ctx.stroke();
  };
  line(b, 'nm', maxNm, '#2a6a7a', 2);
  line(b, 'hp', maxHp, '#7a6a2a', 2);
  line(a, 'nm', maxNm, '#3fe0ff', 3);
  line(a, 'hp', maxHp, '#ffd23f', 3);
}

/**
 * The car computer: program the engine map cell by cell, set the driver
 * switches, and adjust the chassis set-up. Every change is run through the
 * dyno and the benchmark lap at once.
 */
export function mountTune(app: App): Screen {
  const { profile } = app;
  let carId: string | null = profile.selectedCar ?? profile.cars[0]?.id ?? null;
  let sheet = false;

  const carsRow = h('div', { class: 'cars' });
  const ecuBody = h('div', { class: 'scroll t-body' });
  const left = h('div', { class: 'pane t-left' }, h('div', { class: 'title' }, 'Engine computer', h('span', { text: 'Click +  Right-click -  Shift x5' })), carsRow, ecuBody);
  const dynoTitle = h('span', { text: 'Dyno' });
  const dynoNote = h('span');
  const dynoBody = h('div', { class: 'scroll t-body' });
  const right = h('div', { class: 'pane t-right' }, h('div', { class: 'title' }, dynoTitle, dynoNote), dynoBody);
  const root = h('div', {}, left, right);

  const car = (): CarBuild | null => profile.cars.find((c) => c.id === carId) ?? null;

  const stepper = (label: string, text: string, onStep: (dir: number, big: boolean) => void, note = ''): HTMLElement =>
    h('div', { class: 'switch' },
      h('span', { class: 'dim', text: label }),
      h('button', { class: 'btn', text: '-', onclick: (e) => onStep(-1, e.shiftKey) }),
      h('b', { text }),
      h('button', { class: 'btn', text: '+', onclick: (e) => onStep(1, e.shiftKey) }),
      h('span', { class: 'dim note', text: note }),
    );

  const render = (): void => {
    carsRow.replaceChildren();
    profile.cars.forEach((c, i) => {
      carsRow.append(h('div', { class: `car-chip${c.id === carId ? ' on' : ''}`, text: String(i + 1), title: chassisName(c), onclick: () => {
        carId = c.id;
        render();
      } }, h('i', { style: { background: hexColor(c.livery.base) } })));
    });
    ecuBody.replaceChildren();
    dynoBody.replaceChildren();
    const c = car();
    const d = c ? deriveCar(c, app.ref) : null;
    if (!c || !d?.spec || !d.hardware || !d.ecu || !d.ecuResult || !d.setup || !d.stats) {
      ecuBody.append(h('div', { class: 'empty-msg', text: c ? 'This car needs an engine, gearbox and tyres before the computer can be connected.' : 'Build a car in the garage first.' }));
      dynoNote.textContent = '';
      return;
    }
    const hw = d.hardware;
    const map = d.ecu;
    const res = d.ecuResult;
    const setup = d.setup;
    const engine = c.parts.engine ? getPart(c.parts.engine.part) : undefined;
    const ecuPart = c.parts.ecu ? getPart(c.parts.ecu.part) : undefined;
    const safeBuild: CarBuild = { ...c, ecu: undefined };
    const safe = deriveCar(safeBuild, app.ref);

    const setMap = (change: (m: EcuMap) => void): void => {
      const next: EcuMap = { ...map, ign: [...map.ign], lambda: [...map.lambda], boost: [...map.boost] };
      change(next);
      c.ecu = next;
      app.commit();
      render();
    };
    const setSetup = (change: (s: Setup) => void): void => {
      const next = { ...setup };
      change(next);
      c.setup = next;
      app.commit();
      render();
    };

    // --- Map table ----------------------------------------------------------
    ecuBody.append(h('div', { class: 'ecu-head' },
      h('div', {}, h('div', { class: 'gold', text: chassisName(c) }), h('div', { class: 'dim', text: `${alias(engine?.maker ?? '')} ${alias(engine?.name ?? '')}` })),
      h('div', { class: 'dim', style: { textAlign: 'right' } },
        h('div', { text: `ECU: ${alias(ecuPart?.maker ?? 'none')} ${alias(ecuPart?.name ?? '')}` }),
        h('div', { text: `Safe to ${hw.revCeiling} rpm${hw.turbo ? `   Turbos hold ${hw.boostMax.toFixed(2)} bar` : ''}   Knock margin +${hw.knockBonus.toFixed(1)} deg` }),
      ),
    ));

    const table = h('div', { class: 'ecu-table', style: { gridTemplateColumns: `calc(var(--u) * 46) repeat(${ECU_POINTS}, 1fr)` } });
    table.append(h('span', { class: 'dim', text: 'rpm' }));
    for (let i = 0; i < ECU_POINTS; i++) table.append(h('span', { class: 'col', text: String(rpmAtPoint(hw.redline, i)) }));
    const rows: { key: Row; label: string; fmt: (v: number) => string; heat: (v: number, i: number) => number }[] = [
      { key: 'ign', label: 'Ignition deg', fmt: (v) => v.toFixed(1), heat: (v, i) => (v - bestAdvance(hw, i) + 8) / 16 },
      { key: 'lambda', label: 'Lambda', fmt: (v) => v.toFixed(2), heat: (v) => (v - 0.75) / 0.35 },
    ];
    if (hw.turbo) rows.push({ key: 'boost', label: 'Boost bar', fmt: (v) => v.toFixed(2), heat: (v) => v / 2 });
    for (const row of rows) {
      table.append(h('span', { class: 'rowlbl', text: row.label }));
      const lim = ECU_LIMITS[row.key];
      for (let i = 0; i < ECU_POINTS; i++) {
        const t = Math.min(1, Math.max(0, row.heat(map[row.key][i], i)));
        const cell = h('button', {
          class: 'cell',
          text: row.fmt(map[row.key][i]),
          style: { background: `hsl(${220 - 220 * t} 55% ${22 + 14 * t}%)` },
          onclick: (e) => setMap((m) => {
            m[row.key][i] = Math.min(lim.max, m[row.key][i] + lim.step * (e.shiftKey ? 5 : 1));
          }),
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          setMap((m) => {
            m[row.key][i] = Math.max(lim.min, m[row.key][i] - lim.step * (e.shiftKey ? 5 : 1));
          });
        });
        cell.addEventListener('wheel', (e) => {
          e.preventDefault();
          setMap((m) => {
            m[row.key][i] = Math.min(lim.max, Math.max(lim.min, m[row.key][i] + (e.deltaY < 0 ? lim.step : -lim.step)));
          });
        }, { passive: false });
        table.append(cell);
      }
    }
    table.append(h('span', { class: 'rowlbl dim', text: 'To knock deg' }));
    for (let i = 0; i < ECU_POINTS; i++) {
      const margin = res.knockMargin[i];
      table.append(h('span', { class: `read ${margin < 0 ? 'bad' : margin < 1 ? 'gold' : 'good'}`, text: margin < 0 ? `KNOCK ${(-margin).toFixed(1)}` : `+${margin.toFixed(1)}` }));
    }
    table.append(h('span', { class: 'rowlbl dim', text: 'Torque %' }));
    for (let i = 0; i < ECU_POINTS; i++) {
      const f = res.factor[i] * 100;
      table.append(h('span', { class: `read ${f >= 99.5 ? 'good' : f >= 97 ? '' : 'dim'}`, text: f.toFixed(1) }));
    }
    ecuBody.append(table);
    ecuBody.append(h('div', { class: 'dim hintline', text: `Best torque: lambda 0.88, ignition just short of knock${hw.turbo ? `, rated boost ${RATED_BOOST.toFixed(1)} bar. More boost makes power and heat` : ''}. Richer mixture and less advance are safer.` }));

    // --- Driver switches ----------------------------------------------------
    const range = revLimitRange(hw);
    ecuBody.append(
      h('div', { class: 'subhead', text: 'Driver switches' }),
      h('div', { class: 'switches' },
        stepper('Rev limit', `${map.revLimit} rpm`, (dir, big) => setMap((m) => {
          m.revLimit = Math.min(range.max, Math.max(range.min, m.revLimit + dir * (big ? 250 : 50)));
        }), map.revLimit > hw.revCeiling ? 'over the safe ceiling' : ''),
        stepper('Traction control', `${map.tc} / ${AID_LEVELS}`, (dir) => setMap((m) => {
          m.tc = Math.min(AID_LEVELS, Math.max(1, m.tc + dir));
        }), `${(res.tcAssist * 100).toFixed(0)}% help, ${(res.tcMargin * 100).toFixed(1)}% grip held back`),
        stepper('ABS', `${map.abs} / ${AID_LEVELS}`, (dir) => setMap((m) => {
          m.abs = Math.min(AID_LEVELS, Math.max(1, m.abs + dir));
        }), hw.absBest < 0.3 ? 'no ABS unit fitted' : `${(res.absAssist * 100).toFixed(0)}% help, ${(res.absMargin * 100).toFixed(1)}% grip held back`),
        stepper('Launch revs', `${map.launchRpm} rpm`, (dir, big) => setMap((m) => {
          m.launchRpm = Math.min(range.max, Math.max(2000, m.launchRpm + dir * (big ? 500 : 100)));
        }), `0-100 in ${d.stats.accel.toFixed(2)} s`),
        stepper('Pit limiter', `${map.pitLimit} km/h`, (dir) => setMap((m) => {
          m.pitLimit = Math.min(ECU_LIMITS.pitLimit.max, Math.max(ECU_LIMITS.pitLimit.min, m.pitLimit + dir * ECU_LIMITS.pitLimit.step));
        })),
      ),
      h('div', { class: 'actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn', text: 'Load safe base map', onclick: () => setMap((m) => {
          const s = safeMap(hw);
          m.ign = s.ign;
          m.lambda = s.lambda;
          m.boost = s.boost;
          m.revLimit = s.revLimit;
        }) }),
        h('button', { class: 'btn go', text: `Dyno session ${money(DYNO_FEE)}`, disabled: profile.money < DYNO_FEE, title: 'A tuner maps the engine with a safety margin', onclick: () => {
          const r = dynoSession(profile, c);
          if (!r.ok) app.toast(r.reason, true);
          app.commit();
          render();
        } }),
      ),
    );

    // --- Chassis set-up -----------------------------------------------------
    const slider = (label: string, value: number, min: number, max: number, text: string, set: (v: number) => void): HTMLElement => {
      const input = h('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(value);
      input.addEventListener('change', () => set(Number(input.value)));
      return h('div', { class: 'slider' }, h('span', { text: label }), input, h('span', { text }));
    };
    ecuBody.append(
      h('div', { class: 'subhead', text: 'Chassis set-up' }),
      slider('Rear wing angle', setup.wing, SETUP_LIMITS.wing.min, SETUP_LIMITS.wing.max, `${setup.wing > 0 ? '+' : ''}${setup.wing}`, (v) => setSetup((s) => {
        s.wing = v;
      })),
      slider('Brake balance', setup.brakeBias, SETUP_LIMITS.brakeBias.min, SETUP_LIMITS.brakeBias.max, `${(d.spec.brakeBias * 100).toFixed(0)}% F`, (v) => setSetup((s) => {
        s.brakeBias = v;
      })),
      slider('Roll-bar balance', setup.balance, SETUP_LIMITS.balance.min, SETUP_LIMITS.balance.max, setup.balance === 0 ? 'neutral' : setup.balance > 0 ? 'oversteer' : 'understeer', (v) => setSetup((s) => {
        s.balance = v;
      })),
      slider('Start fuel', setup.fuel, 8, d.spec.fuelCapacity, `${setup.fuel} kg`, (v) => setSetup((s) => {
        s.fuel = v;
      })),
    );

    // --- Dyno and results ---------------------------------------------------
    const s = d.stats;
    const base = safe.stats;
    dynoNote.textContent = `${s.powerHp.toFixed(0)} hp   ${s.torqueNm.toFixed(0)} Nm`;
    const sheetBtn = h('button', { class: 'btn', text: sheet ? 'Show dyno' : 'Full spec sheet', onclick: () => {
      sheet = !sheet;
      render();
    } });
    if (sheet) {
      dynoTitle.textContent = 'Spec sheet';
      dynoBody.append(specSheet(d, chassisName(c)), h('div', { class: 'actions' }, sheetBtn));
      return;
    }
    dynoTitle.textContent = 'Dyno';
    const canvas = h('canvas', { class: 'dyno' });
    drawDyno(canvas, d, safe);
    const delta = (now: number, was: number | undefined, digits: number, lowerBetter = false): HTMLElement => {
      if (was === undefined) return h('span');
      const diff = now - was;
      if (Math.abs(diff) < 0.5 * 10 ** -digits) return h('span', { class: 'dim', text: '=' });
      return h('span', { class: (lowerBetter ? diff < 0 : diff > 0) ? 'good' : 'bad', text: `${diff > 0 ? '+' : ''}${diff.toFixed(digits)}` });
    };
    const readout = h('div', { class: 'readout' },
      h('span', { class: 'dim', text: 'Peak power' }), h('span', { class: 'gold', text: `${s.powerHp.toFixed(0)} hp` }), delta(s.powerHp, base?.powerHp, 0),
      h('span', { class: 'dim', text: 'Peak torque' }), h('span', { text: `${s.torqueNm.toFixed(0)} Nm` }), delta(s.torqueNm, base?.torqueNm, 0),
      h('span', { class: 'dim', text: 'Fuel per lap' }), h('span', { text: `${s.fuelPerLap.toFixed(2)} kg` }), delta(s.fuelPerLap, base?.fuelPerLap, 2, true),
      h('span', { class: 'dim', text: 'Fuel range' }), h('span', { text: `${s.fuelLaps.toFixed(0)} laps` }), h('span'),
      h('span', { class: 'dim', text: 'Engine life' }), h('span', { class: res.reliability < 0.9 ? 'bad' : '', text: `${(res.reliability * 100).toFixed(0)}%` }), h('span'),
      h('span', { class: 'dim', text: 'Top speed' }), h('span', { text: `${s.topSpeedKmh.toFixed(0)} km/h` }), delta(s.topSpeedKmh, base?.topSpeedKmh, 0),
      h('span', { class: 'dim', text: 'Downforce' }), h('span', { text: `${s.downforceKg.toFixed(0)} kg` }), h('span'),
      h('span', { class: 'dim', text: 'Lap estimate' }), h('span', { class: 'gold', text: lapText(s.lapTime) }), delta(s.lapTime, base?.lapTime, 2, true),
      h('span', { class: 'dim', text: 'Overall rating' }), h('span', { text: String(s.rating) }), delta(s.rating, base?.rating, 0),
    );
    dynoBody.append(
      canvas,
      h('div', { class: 'dim hintline', text: 'Yellow: power (hp). Blue: torque (Nm). Faint lines: safe base map. Changes are compared with the safe map.' }),
      readout,
      h('div', { class: 'sheet-notes' }, ...(d.notes.length ? d.notes.map((n) => h('div', { class: 'bad', text: n })) : [h('div', { class: 'good', text: 'No warnings from the engine computer.' })])),
      h('div', { class: 'actions' }, sheetBtn),
    );
  };

  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  app.garage.setViewShift(0);
  render();
  return { root };
}
