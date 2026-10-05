import { alias } from '../data/naming';
import { Part, SLOTS, SlotId, getPart, partsForSlot } from '../data/parts';
import {
  CONDITIONS,
  CONDITION_ORDER,
  CarBuild,
  CarStats,
  Condition,
  DerivedCar,
  MAX_CARS,
  buildResale,
  chassisName,
  completionKit,
  deriveCar,
  slotApplies,
  incompatibility,
  partPrice,
  resaleValue,
  swapCost,
} from '../game/build';
import { applyAutoBuild, buyCar, entryFee, fitKit, fitPart, removePart, sellCar } from '../game/profile';
import { TRACKS } from '../data/tracks';
import { ratingGrade, specSheet } from './specSheet';
import type { App, Screen } from './appTypes';
import { h, hexColor, lapText, money } from './dom';
import { paneTitle } from './widgets';

interface StatRow {
  key: keyof CarStats;
  label: string;
  /** Which direction is an improvement. */
  better: 'high' | 'low';
  lo: number;
  hi: number;
  fmt: (v: number) => string;
}

const STAT_ROWS: readonly StatRow[] = [
  { key: 'powerHp', label: 'Power', better: 'high', lo: 360, hi: 640, fmt: (v) => `${v.toFixed(0)} hp` },
  { key: 'massKg', label: 'Weight', better: 'low', lo: 1200, hi: 1380, fmt: (v) => `${v.toFixed(0)} kg` },
  { key: 'topSpeedKmh', label: 'Top speed', better: 'high', lo: 240, hi: 295, fmt: (v) => `${v.toFixed(0)} km/h` },
  { key: 'accel', label: '0-100 km/h', better: 'low', lo: 1.9, hi: 4.0, fmt: (v) => `${v.toFixed(2)} s` },
  { key: 'braking', label: '200-0 km/h', better: 'low', lo: 72, hi: 104, fmt: (v) => `${v.toFixed(1)} m` },
  { key: 'gripG', label: 'Cornering', better: 'high', lo: 1.45, hi: 2.0, fmt: (v) => `${v.toFixed(2)} g` },
  { key: 'downforceKg', label: 'Downforce', better: 'high', lo: 180, hi: 600, fmt: (v) => `${v.toFixed(0)} kg` },
  { key: 'dragCdA', label: 'Drag', better: 'low', lo: 0.82, hi: 1.02, fmt: (v) => v.toFixed(3) },
  { key: 'reliability', label: 'Reliability', better: 'high', lo: 0.3, hi: 0.9, fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'lapTime', label: 'Lap estimate', better: 'low', lo: 40.5, hi: 50, fmt: lapText },
];

const PAINT = [
  0xd8232a, 0xf07a1c, 0xf2c21a, 0x1fa85a, 0x10b6d8, 0x1f6fe0, 0x8a35d6, 0xe84a8a, 0xf4f4f0, 0x8a8f9c, 0x22242c,
];

/** Short stat tags for a part card. */
function chips(part: Part): string[] {
  const f = part.fx;
  const out: string[] = [];
  const pct = (v: number, label: string): void => {
    if (v) out.push(`${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}% ${label}`);
  };
  if (f.kw) out.push(`${Math.round(f.kw * 1.341)} hp`, `${f.redline} rpm`, f.turbo ? 'turbo' : 'non-turbo');
  if (f.mu) out.push(`grip ${f.mu.toFixed(3)}`, `life ${Math.round(1 / (f.tyreWear ?? 8e-6) / 1000)} km`);
  pct(f.power ?? 0, 'power');
  pct(f.grip ?? 0, 'grip');
  pct(f.brake ?? 0, 'braking');
  pct(f.wear ?? 0, 'tyre wear');
  if (f.cl) out.push(`downforce ${f.cl.toFixed(2)}`, `drag ${(f.cd ?? 0).toFixed(3)}`);
  if (part.slot === 'gearbox') out.push(`shift ${Math.round((f.shift ?? 0) * 1000)} ms`, `eff +${((f.eff ?? 0) * 100).toFixed(1)}%`);
  else if (part.slot === 'shift') out.push(`shift x${(f.shift ?? 1).toFixed(2)}`);
  else if (part.slot === 'clutch') out.push(`shift +${Math.round((f.shift ?? 0) * 1000)} ms`);
  else if (f.eff) out.push(`eff +${(f.eff * 100).toFixed(1)}%`);
  if (f.tc !== undefined) out.push(`TC ${(f.tc * 100).toFixed(0)}%`);
  if (f.abs !== undefined) out.push(`ABS ${(f.abs * 100).toFixed(0)}%`);
  if (f.fuelKg) out.push(`${f.fuelKg} kg fuel`);
  if (f.comfort) out.push(`comfort +${(f.comfort * 100).toFixed(0)}`);
  if (f.safety) out.push(`safety ${f.safety.toFixed(1)}`);
  if (f.pit) out.push(`pit stop -${f.pit}s`);
  if (f.revs) out.push(`${f.revs > 0 ? '+' : ''}${f.revs} rpm safe`);
  if (f.flow) out.push(`feeds ${Math.round(f.flow * 1.341)} hp`);
  if (f.knock) out.push(`+${f.knock.toFixed(1)} deg to knock`);
  if (f.boostMax) out.push(`holds ${f.boostMax.toFixed(2)} bar`);
  if (f.ratio) out.push(`ratio x${f.ratio.toFixed(2)}`);
  if (part.chassis) out.push(`${part.chassis.layout} engine`, `${(part.chassis.frontWeight * 100).toFixed(0)}% front`, `${part.chassis.wheelbase.toFixed(2)} m wb`);
  out.push(`${part.mass} kg`, `rel ${(part.rel * 100).toFixed(1)}%`);
  return out;
}

export function mountGarage(app: App): Screen {
  const { profile } = app;
  let carId: string | null = profile.selectedCar ?? profile.cars[0]?.id ?? null;
  let slot: SlotId = 'chassis';
  let derived: DerivedCar | null = null;

  const carsRow = h('div', { class: 'cars' });
  const head = h('div', { class: 'car-head' });
  const slotList = h('div', { class: 'scroll' });
  const left = h('div', { class: 'pane g-left' }, paneTitle('wrench', 'Your garage', h('span', { text: `${MAX_CARS} bays` })), carsRow, head, slotList);

  const partsTitle = h('span');
  const partsNote = h('span');
  const partList = h('div', { class: 'scroll' });
  const right = h('div', { class: 'pane g-right' }, paneTitle('cog', partsTitle, partsNote), partList);

  const statsTitle = h('span', { text: 'Car stats' });
  const statsNote = h('span');
  const statGrid = h('div', { class: 'stat-grid' });
  const stats = h('div', { class: 'pane g-stats' }, paneTitle('chart', statsTitle, statsNote), statGrid);

  const explodeBtn = h('button', { class: 'btn', text: 'Lift body', onclick: () => {
    app.garage.setExploded(!app.garage.exploded);
    explodeBtn.textContent = app.garage.exploded ? 'Lower body' : 'Lift body';
  } });
  const baseSw = h('div', { class: 'swatches' });
  const accentSw = h('div', { class: 'swatches' });
  const tools = h('div', { class: 'g-tools' },
    explodeBtn,
    h('button', { class: 'btn', text: 'Reset view', onclick: () => app.garage.resetView() }),
    h('button', { class: 'btn', text: 'Spec sheet', onclick: () => {
      sheetOpen = !sheetOpen;
      sheetPane.classList.toggle('hidden', !sheetOpen);
      showStats(derived, null, derived?.stats ? 'Benchmark lap' : '');
    } }),
    h('span', { class: 'sep' }),
    h('span', { class: 'paint' }, 'Paint', baseSw),
    h('span', { class: 'paint' }, 'Stripe', accentSw),
  );
  const hint = h('div', { class: 'g-hint', text: 'Drag: rotate   Wheel: zoom   Right-drag: pan' });
  let sheetOpen = false;
  const sheetPane = h('div', { class: 'pane g-sheet hidden' });
  const root = h('div', {}, left, right, stats, tools, hint, sheetPane);

  const car = (): CarBuild | null => profile.cars.find((c) => c.id === carId) ?? null;

  const renderCars = (): void => {
    carsRow.replaceChildren();
    for (let i = 0; i < MAX_CARS; i++) {
      const c = profile.cars[i];
      if (c) {
        carsRow.append(h('div', {
          class: `car-chip${c.id === carId ? ' on' : ''}`, text: String(i + 1), title: c.name,
          onclick: () => select(c.id),
        }, h('i', { style: { background: hexColor(c.livery.base) } })));
      } else {
        carsRow.append(h('div', {
          class: `car-chip empty${carId === null && i === profile.cars.length ? ' on' : ''}`, text: '+', title: 'Buy a new chassis',
          onclick: () => select(null),
        }));
      }
    }
  };

  const renderHead = (): void => {
    const c = car();
    head.replaceChildren();
    if (!c) {
      head.append(h('div', { class: 'name', text: 'New car' }), h('div', { class: 'dim', text: 'Choose a chassis to start a build' }));
      return;
    }
    const d = derived;
    const slots = SLOTS.filter((s) => slotApplies(c, s));
    const fitted = slots.filter((s) => c.parts[s.id]).length;
    head.append(
      h('div', { class: 'name', text: chassisName(c) }),
      h('div', { class: 'fitted' },
        h('span', { text: 'Parts fitted' }),
        h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round((fitted / Math.max(1, slots.length)) * 100)}%` } })),
        h('span', { text: `${fitted} / ${slots.length}` }),
      ),
      h('div', { class: 'row' },
        d?.legal
          ? h('span', { class: 'badge ok', text: 'Race legal' })
          : h('span', { class: 'badge', text: d?.issues.length ? 'Parts clash' : `${d?.missing.length ?? 0} parts missing` }),
        h('span', { class: 'dim', text: `Value ${money(d?.value ?? 0)}` }),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn warn', text: `Sell car ${money(buildResale(c))}`, onclick: () => {
          app.confirm(`Sell ${chassisName(c)} and all its parts for ${money(buildResale(c))}?`, 'Sell car', () => {
            sellCar(profile, c.id);
            app.commit();
            select(profile.cars[0]?.id ?? null);
          }, true);
        } }),
        h('button', { class: 'btn', text: 'Use in race', disabled: !d?.legal || profile.selectedCar === c.id, onclick: () => {
          profile.selectedCar = c.id;
          app.commit();
          renderHead();
        } }),
      ),
    );
    const reserve = entryFee(TRACKS[0]) * 2;
    head.append(h('div', { class: 'row' }, h('button', {
      class: 'btn go', style: { flex: '1' },
      text: profile.admin ? 'Auto build: best parts' : `Auto build: best for ${money(Math.max(0, profile.money + buildResale(c) - resaleValue(c.parts.chassis) - reserve))}`,
      title: 'Replaces every part except the chassis with the fastest, most reliable set the budget buys',
      onclick: () => app.confirm(
        profile.admin
          ? 'Fit the best part in every slot? Current parts are replaced.'
          : `Rebuild this car with the best parts your budget buys? Current parts are traded in at 60% and ${money(reserve)} is kept back for entry fees. The engine map goes back to the safe base map.`,
        'Auto build',
        () => {
          app.toast('Choosing parts...');
          // Let the message paint before the search runs.
          setTimeout(() => {
            const r = applyAutoBuild(profile, c, app.ref, reserve);
            if (!r.ok) {
              app.toast(r.reason, true);
              return;
            }
            app.commit();
            refresh();
            app.toast(`Auto build done: rating ${derived?.stats?.rating ?? '-'}`);
          }, 30);
        },
      ),
    })));
    if (d && d.missing.length) {
      const row = h('div', { class: 'row kit' }, h('span', { class: 'dim', text: 'Fill empty slots' }));
      for (const cond of CONDITION_ORDER) {
        const kit = completionKit(c, cond);
        row.append(h('button', {
          class: 'btn', disabled: kit.cost > profile.money, title: `Cheapest ${CONDITIONS[cond].label.toLowerCase()} part for each of ${kit.parts.length} empty slots`,
          onclick: () => act(fitKit(profile, c, cond)),
        }, CONDITIONS[cond].label, h('small', { text: money(kit.cost) })));
      }
      head.append(row);
    }
    for (const note of d?.notes ?? []) head.append(h('div', { class: 'bad note', text: note }));
  };

  const renderSlots = (): void => {
    const c = car();
    slotList.replaceChildren();
    if (!c) {
      slotList.append(h('div', { class: 'empty-msg', text: 'An empty bay. Buy a rolling shell on the right, then fit every part to make it race legal.' }));
      return;
    }
    let group = '';
    const applied = SLOTS.filter((s) => slotApplies(c, s));
    for (const s of applied) {
      if (s.group !== group) {
        group = s.group;
        const inGroup = applied.filter((x) => x.group === group);
        const done = inGroup.filter((x) => c.parts[x.id]).length;
        slotList.append(h('div', { class: 'group' }, h('span', { text: group }), h('span', { class: `count${done < inGroup.length ? ' short' : ''}`, text: `${done}/${inGroup.length}` })));
      }
      const f = c.parts[s.id];
      const p = f ? getPart(f.part) : undefined;
      slotList.append(h('div', {
        class: `slot${s.id === slot ? ' on' : ''}`,
        onclick: () => {
          slot = s.id;
          app.garage.setFocus(slot);
          explodeBtn.textContent = app.garage.exploded ? 'Lower body' : 'Lift body';
          renderSlots();
          renderParts();
        },
      },
        h('i', { class: `dot${p ? '' : ' none'}` }),
        h('span', { text: s.label }),
        h('span', { class: `fit${p ? '' : ' none'}`, text: p ? alias(`${p.maker} ${p.name}`) : 'Empty' }),
        h('span', { class: `cond ${f?.cond ?? ''}`, text: f ? CONDITIONS[f.cond].label : '' }),
      ));
    }
  };

  const showStats = (d: DerivedCar | null, trial: DerivedCar | null, note: string): void => {
    statGrid.replaceChildren();
    statsNote.textContent = note;
    const rated = (trial ?? d)?.stats;
    statsTitle.textContent = rated ? `Overall ${rated.rating}  Class ${ratingGrade(rated.rating)}` : 'Car stats';
    if (sheetOpen) {
      const c = car();
      sheetPane.replaceChildren(h('div', { class: 'title' }, 'Spec sheet', h('span', { text: note })), h('div', { class: 'scroll' }, c && (trial ?? d) ? specSheet((trial ?? d)!, chassisName(c)) : null));
    }
    const baseStats = d?.stats ?? null;
    const shown = trial?.stats ?? baseStats;
    if (!shown) {
      const c = car();
      statGrid.append(h('div', {
        class: 'dim', style: { gridColumn: '1 / -1' },
        text: c ? 'Fit an engine, gearbox and tyres to see performance figures.' : 'No car selected.',
      }));
      return;
    }
    for (const row of STAT_ROWS) {
      const v = shown[row.key];
      const norm = (x: number): number => {
        const t = (x - row.lo) / (row.hi - row.lo);
        return Math.round(Math.min(1, Math.max(0.03, row.better === 'high' ? t : 1 - t)) * 100);
      };
      const meter = h('div', { class: 'meter' });
      let delta = h('span', { class: 'delta' });
      if (trial?.stats && baseStats) {
        const diff = v - baseStats[row.key];
        const improved = row.better === 'high' ? diff > 0 : diff < 0;
        const big = Math.abs(diff) > Math.abs(baseStats[row.key]) * 0.0005;
        meter.append(h('i', { class: 'ghost', style: { width: `${norm(v)}%` } }), h('i', { style: { width: `${Math.min(norm(v), norm(baseStats[row.key]))}%` } }));
        if (big) {
          const text = row.key === 'reliability' ? `${(diff * 100).toFixed(1)}` : row.key === 'lapTime' || row.key === 'accel' || row.key === 'dragCdA' || row.key === 'gripG' ? diff.toFixed(2) : diff.toFixed(0);
          delta = h('span', { class: `delta ${improved ? 'good' : 'bad'}`, text: `${diff > 0 ? '+' : ''}${text}` });
        }
      } else {
        meter.append(h('i', { style: { width: `${norm(v)}%` } }));
      }
      statGrid.append(h('div', { class: 'stat' }, h('span', { class: 'lbl', text: row.label }), meter, h('span', { class: 'val', text: row.fmt(v) }), delta));
    }
  };

  const preview = (part: Part | null, cond: Condition): void => {
    const c = car();
    if (!c || !part) {
      app.garage.setCar(c);
      showStats(derived, null, derived?.stats ? 'Benchmark lap' : '');
      return;
    }
    const trial: CarBuild = { ...c, parts: { ...c.parts, [part.slot]: { part: part.id, cond } } };
    app.garage.setCar(trial);
    showStats(derived, deriveCar(trial, app.ref), `Preview: ${alias(part.name)}`);
  };

  const renderParts = (): void => {
    const c = car();
    const def = SLOTS.find((s) => s.id === slot);
    partsTitle.textContent = c ? (def?.label ?? '') : 'Choose a chassis';
    const applies = !c || !def || slotApplies(c, def);
    const options = applies ? partsForSlot(c ? slot : 'chassis') : [];
    partsNote.textContent = `${options.length} parts`;
    partList.replaceChildren();
    const current = c?.parts[slot];

    if (c && current && slot !== 'chassis') {
      partList.append(h('div', { class: 'part' }, h('div', { class: 'buy' },
        h('button', { class: 'btn', text: `Remove and sell  +${money(resaleValue(current))}`, onclick: () => act(removePart(profile, c, slot)) }),
      )));
    }

    for (const part of options) {
      const why = c ? incompatibility(c, part) : null;
      const fittedHere = current?.part === part.id;
      const buy = h('div', { class: 'buy' });
      for (const cond of CONDITION_ORDER) {
        const have = fittedHere && current?.cond === cond;
        const cost = c ? swapCost(c, part, cond) : partPrice(part, cond);
        const affordable = cost <= profile.money;
        buy.append(h('button', {
          class: `btn${have ? ' have' : ''}`,
          disabled: have || !!why || !affordable,
          title: have ? 'Fitted' : !affordable ? 'Not enough money' : `${CONDITIONS[cond].label}: list ${money(partPrice(part, cond))}`,
          onenter: () => !why && preview(part, cond),
          onclick: () => {
            if (!c) {
              act(buyCar(profile, part, cond, ''));
              carId = profile.selectedCar;
              slot = 'engine';
              refresh();
              app.garage.setFocus(slot);
            } else {
              act(fitPart(profile, c, part, cond));
            }
          },
        }, CONDITIONS[cond].label, h('small', { text: have ? 'Fitted' : c ? (cost >= 0 ? money(cost) : `+${money(-cost)}`) : money(cost) })));
      }
      partList.append(h('div', {
        class: `part${fittedHere ? ' fitted' : ''}${why ? ' locked' : ''}`,
        onleave: () => preview(null, 'new'),
      },
        h('div', { class: 'pname' }, h('span', { text: alias(part.name) }), h('span', { class: 'gold', text: '★'.repeat(part.tier) })),
        h('div', { class: 'maker', text: alias(part.maker) }),
        h('div', { class: 'note', text: why ?? part.note }),
        c && !why && !fittedHere ? deltas(c, part) : null,
        h('div', { class: 'chips' }, ...chips(part).map((t) => h('span', { class: 'chip', text: t }))),
        buy,
      ));
    }
  };

  /** Green and red pills: what fitting the part new would change on this car. */
  const deltas = (c: CarBuild, part: Part): HTMLElement | null => {
    const was = derived?.stats;
    const now = deriveCar({ ...c, parts: { ...c.parts, [part.slot]: { part: part.id, cond: 'new' } } }, app.ref).stats;
    if (!was || !now) return null;
    const pills: HTMLElement[] = [];
    const add = (diff: number, text: string, better: boolean, min: number): void => {
      if (Math.abs(diff) >= min) pills.push(h('span', { class: `dpill ${better ? 'good' : 'bad'}`, text }));
    };
    const sign = (v: number, digits = 0): string => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
    add(now.rating - was.rating, `Rating ${sign(now.rating - was.rating)}`, now.rating > was.rating, 0.5);
    add(now.lapTime - was.lapTime, `Lap ${sign(now.lapTime - was.lapTime, 2)} s`, now.lapTime < was.lapTime, 0.005);
    add(now.powerHp - was.powerHp, `${sign(now.powerHp - was.powerHp)} hp`, now.powerHp > was.powerHp, 0.5);
    add(now.massKg - was.massKg, `${sign(now.massKg - was.massKg)} kg`, now.massKg < was.massKg, 0.5);
    add((now.reliability - was.reliability) * 100, `Rel ${sign((now.reliability - was.reliability) * 100, 1)}%`, now.reliability > was.reliability, 0.05);
    return h('div', { class: 'deltas' }, h('span', { class: 'cap', text: 'Fitted new' }), ...(pills.length ? pills : [h('span', { class: 'dpill', text: 'No change' })]));
  };

  const renderPaint = (): void => {
    const c = car();
    baseSw.replaceChildren();
    accentSw.replaceChildren();
    if (!c) return;
    for (const color of PAINT) {
      baseSw.append(h('div', { class: `swatch${c.livery.base === color ? ' on' : ''}`, style: { background: hexColor(color) }, onclick: () => {
        c.livery.base = color;
        app.commit();
        app.garage.setCar(c);
        renderPaint();
        renderCars();
      } }));
      accentSw.append(h('div', { class: `swatch${c.livery.accent === color ? ' on' : ''}`, style: { background: hexColor(color) }, onclick: () => {
        c.livery.accent = color;
        app.commit();
        app.garage.setCar(c);
        renderPaint();
      } }));
    }
  };

  const act = (result: { ok: true } | { ok: false; reason: string }): void => {
    if (!result.ok) {
      app.toast(result.reason, true);
      return;
    }
    app.commit();
    refresh();
  };

  const refresh = (): void => {
    const c = car();
    derived = c ? deriveCar(c, app.ref) : null;
    // A car that stops being legal cannot stay selected for racing.
    if (c && profile.selectedCar === c.id && !derived?.legal) profile.selectedCar = null;
    if (c && derived?.legal && !profile.selectedCar) {
      profile.selectedCar = c.id;
      app.commit();
    }
    app.garage.setCar(c);
    renderCars();
    renderHead();
    renderSlots();
    renderParts();
    renderPaint();
    showStats(derived, null, derived?.stats ? 'Benchmark lap' : '');
  };

  const select = (id: string | null): void => {
    carId = id;
    slot = 'chassis';
    app.garage.setFocus(null);
    app.garage.resetView();
    explodeBtn.textContent = 'Lift body';
    refresh();
  };

  app.garage.autoRotate = false;
  // Centre the car in the gap between the side panels.
  app.garage.setViewShift(-0.02, 0.06);
  refresh();
  return { root, dispose: () => app.garage.setFocus(null) };
}
