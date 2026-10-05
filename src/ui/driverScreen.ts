import { deriveCar } from '../game/build';
import {
  DriverLook,
  MAX_DRIVERS,
  PlayerDriver,
  addSkillPoint,
  blankDriver,
  fireDriver,
  hireDriver,
  pointsAvailable,
  skillCap,
} from '../game/profile';
import {
  DriverDef,
  SKILLS,
  SKILL_CAP_AT_CREATION,
  SKILL_LABELS,
  STARTING_POINTS,
  Skill,
  deriveProfile,
  pointsAllowed,
  pointsSpent,
} from '../sim/driver';
import { computeSpeedProfile } from '../sim/line';
import type { App, Screen } from './appTypes';
import { h, lapText } from './dom';
import { paneTitle } from './widgets';
import { LOOK_KEYS, LOOK_LABELS, LOOK_OPTIONS, SWATCH_KEYS, defaultLook, drawPortrait, lookValue } from './portrait';

const NATIONS = ['GBR', 'GER', 'ITA', 'FRA', 'ESP', 'NED', 'BEL', 'USA', 'BRA', 'JPN', 'AUS', 'SWE', 'FIN', 'POL', 'MEX', 'ARG', 'RSA', 'CAN'];

const TRAITS: Record<Skill, [string, string]> = {
  reaction: ['Lightning off the line', 'Slow to react at the start'],
  anticipation: ['Reads traffic early', 'Gets caught out by traffic'],
  carControl: ['Catches big slides', 'Spins when the car steps out'],
  braking: ['Brakes late and precisely', 'Brakes early'],
  cornering: ['Carries speed through corners', 'Slow in the middle of corners'],
  racecraft: ['Clean, clever overtaker', 'Clumsy wheel to wheel'],
  consistency: ['Metronomic lap times', 'Erratic lap times'],
  attention: ['Looks after tyres and fuel', 'Misses the details'],
  endurance: ['Still fresh at the flag', 'Fades in long races'],
  composure: ['Ice cold under pressure', 'Cracks under pressure'],
  sympathy: ['Easy on the machinery', 'Hard on the car'],
  discipline: ['Follows flags and team orders', 'Ignores flags and orders'],
};

/** Plain-language summary of what the allocation means on track. */
function describe(def: DriverDef): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  const ranked = [...SKILLS].sort((a, b) => def.skills[b] - def.skills[a]);
  for (const s of ranked.slice(0, 3)) if (def.skills[s] >= 11) out.push({ text: TRAITS[s][0], good: true });
  for (const s of ranked.slice(-3).reverse()) if (def.skills[s] <= 5) out.push({ text: TRAITS[s][1], good: false });
  if (def.aggression > 0.68) out.push({ text: 'Dives for every gap', good: def.skills.racecraft >= 10 });
  else if (def.aggression < 0.32) out.push({ text: 'Waits for a safe pass', good: true });
  if (def.risk > 0.68) out.push({ text: 'Drives on the ragged edge', good: def.skills.carControl >= 10 });
  else if (def.risk < 0.32) out.push({ text: 'Leaves a safety margin', good: true });
  if (def.risk > 0.6 && def.skills.carControl < 8) out.push({ text: 'Takes risks the car control cannot back up', good: false });
  if (def.aggression > 0.6 && def.skills.racecraft < 8) out.push({ text: 'Aggression without racecraft: expect contact', good: false });
  return out;
}

function drawRadar(canvas: HTMLCanvasElement, def: DriverDef, cap: number): void {
  const W = 260, H = 220;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cx = W / 2, cy = H / 2 + 2, R = 78;
  const n = SKILLS.length;
  const pt = (i: number, r: number): [number, number] => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = ring === 1 ? '#8a90b4' : '#3a3f66';
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pt(i % n, R * ring);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#3a3f66';
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(...pt(i, R));
    ctx.stroke();
  }
  ctx.beginPath();
  SKILLS.forEach((s, i) => {
    const [x, y] = pt(i, R * Math.min(1, def.skills[s] / cap));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(63, 224, 255, 0.35)';
  ctx.fill();
  ctx.strokeStyle = '#3fe0ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f4f4f0';
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textBaseline = 'middle';
  SKILLS.forEach((s, i) => {
    const [x, y] = pt(i, R + 12);
    const label = SKILL_LABELS[s].slice(0, 4).toUpperCase();
    ctx.textAlign = Math.abs(x - cx) < 6 ? 'center' : x > cx ? 'left' : 'right';
    ctx.fillText(label, x, y);
  });
}

export function mountDrivers(app: App): Screen {
  const { profile } = app;
  /** A driver id, or 'new' for the creator. */
  let selected: string = profile.selectedDriver ?? profile.drivers[0]?.def.id ?? 'new';
  let draft: DriverDef = blankDriver();
  let draftLook: DriverLook = defaultLook();

  const roster = h('div', { class: 'scroll' });
  const left = h('div', { class: 'pane d-left' }, paneTitle('helmet', 'Drivers', h('span', { text: `${MAX_DRIVERS} seats` })), roster);
  const mainTitle = h('span');
  const mainNote = h('span');
  const body = h('div', { class: 'd-body' });
  const main = h('div', { class: 'pane d-main' }, paneTitle('user', mainTitle, mainNote), body);
  const root = h('div', {}, left, main);

  const refCar = (): ReturnType<typeof deriveCar>['spec'] => {
    const car = profile.cars.find((c) => c.id === profile.selectedCar);
    return car ? deriveCar(car).spec : null;
  };

  const facts = (def: DriverDef): HTMLElement => {
    const p = deriveProfile(def);
    const rows: [string, string][] = [
      ['Reaction time', `${p.reactionTime.toFixed(2)} s`],
      ['Grip used in corners', `${Math.min(100, p.cornerGrip * 100).toFixed(0)}%`],
      ['Grip used braking', `${Math.min(100, p.brakeGrip * 100).toFixed(0)}%`],
      ['Lap-time spread', `+-${(p.paceNoise * 100).toFixed(1)}%`],
      ['Error per braking zone', `${(p.mistakeRate * 100).toFixed(1)}%`],
      ['Stamina', `${Math.round(1 / p.fatigueRate / 60)} min`],
      ['Following gap', `${p.followGap.toFixed(1)} m`],
      ['Tyre wear', `x${p.wearFactor.toFixed(2)}`],
    ];
    const spec = refCar();
    if (spec) {
      const v = computeSpeedProfile(app.ref.track, app.ref.line, spec, {
        mass: spec.mass + p.mass + spec.fuelCapacity * 0.35, cornerGrip: p.cornerGrip, brakeGrip: p.brakeGrip,
      });
      let t = 0;
      for (let i = 0; i < app.ref.track.n; i++) t += app.ref.track.ds / v[i];
      rows.push(['Lap in your car', lapText(t)]);
    }
    const box = h('div', { class: 'facts' });
    for (const [k, v] of rows) box.append(h('span', { text: k }), h('span', { text: v }));
    return box;
  };

  const renderRoster = (): void => {
    roster.replaceChildren();
    for (let i = 0; i < MAX_DRIVERS; i++) {
      const d = profile.drivers[i];
      if (!d) {
        roster.append(h('div', {
          class: `roster vacant${selected === 'new' && i === profile.drivers.length ? ' on' : ''}`,
          text: i === profile.drivers.length ? '+ Sign a driver' : 'Empty seat',
          onclick: () => {
            selected = 'new';
            render();
          },
        }));
        continue;
      }
      const canvas = h('canvas', { class: 'portrait' });
      drawPortrait(canvas, d.look);
      const spare = pointsAvailable(d.def);
      roster.append(h('div', {
        class: `roster${selected === d.def.id ? ' on' : ''}`,
        onclick: () => {
          selected = d.def.id;
          render();
        },
      }, canvas, h('div', {},
        h('div', { class: 'gold', text: d.def.name }),
        h('div', { class: 'dim', text: `${d.def.nationality}  ${d.def.racesCompleted} races` }),
        h('div', { class: spare ? 'good' : 'dim', text: spare ? `${spare} point${spare > 1 ? 's' : ''} to spend` : `${pointsAllowed(d.def)} points` }),
        profile.selectedDriver === d.def.id ? h('div', { class: 'good', text: 'Race driver' }) : null,
      )));
    }
  };

  /** Skill rows. In the creator every skill can move both ways; a signed driver can only gain. */
  const skillRows = (def: DriverDef, creating: boolean, onChange: () => void, unlocked = false): HTMLElement => {
    const box = h('div', { class: 'skills' });
    const cap = unlocked ? 25 : creating ? SKILL_CAP_AT_CREATION : skillCap(def);
    const free = unlocked ? 999 : creating ? STARTING_POINTS - pointsSpent(def) : pointsAvailable(def);
    if (unlocked) creating = true;
    for (const s of SKILLS) {
      const value = def.skills[s];
      const pips = h('div', { class: 'pips' });
      for (let i = 0; i < cap; i++) {
        pips.append(h('i', {
          class: i < value ? `on${value >= 15 ? ' hi' : ''}` : '',
          onclick: creating ? () => {
            const want = i + 1 === value ? i : i + 1;
            def.skills[s] = Math.max(0, Math.min(want, value + (unlocked ? 999 : STARTING_POINTS - pointsSpent(def))));
            onChange();
          } : undefined,
        }));
      }
      box.append(h('div', { class: 'skill' },
        h('span', { text: SKILL_LABELS[s] }),
        creating
          ? h('button', { class: 'btn', text: '-', disabled: value <= 0, onclick: () => {
            def.skills[s] -= 1;
            onChange();
          } })
          : h('span'),
        pips,
        h('button', { class: 'btn', text: '+', disabled: free <= 0 || value >= cap, onclick: () => {
          if (creating) def.skills[s] += 1;
          else if (!addSkillPoint(def, s).ok) return;
          onChange();
        } }),
        h('span', { text: String(value) }),
      ));
    }
    return box;
  };

  const slider = (label: string, value: number, min: number, max: number, fmt: (v: number) => string, locked: boolean, set: (v: number) => void): HTMLElement => {
    const out = h('span', { text: fmt(value) });
    const input = h('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.disabled = locked;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      set(v);
    });
    return h('div', { class: 'slider' }, h('span', { text: label }), input, out);
  };

  const renderCreator = (): void => {
    const spent = pointsSpent(draft);
    const left = STARTING_POINTS - spent;
    mainTitle.textContent = 'Sign a new driver';
    mainNote.textContent = 'Skills lock when you sign';
    body.replaceChildren();

    const portrait = h('canvas', { class: 'portrait large' });
    drawPortrait(portrait, draftLook);
    const name = h('input');
    name.type = 'text';
    name.maxLength = 22;
    name.placeholder = 'Driver name';
    name.value = draft.name;
    name.addEventListener('input', () => {
      draft.name = name.value;
    });
    const cycle = (label: string, options: readonly string[], index: number, set: (i: number) => void, swatch = false): HTMLElement =>
      h('div', { class: 'field' }, h('span', { class: 'dim', text: label }), h('div', { class: 'cycler' },
        h('button', { class: 'btn', text: '<', onclick: () => set((index + options.length - 1) % options.length) }),
        swatch ? h('span', { style: { background: options[index], height: 'calc(var(--u) * 6)' } }) : h('span', { text: options[index] }),
        h('button', { class: 'btn', text: '>', onclick: () => set((index + 1) % options.length) }),
      ));
    const colA = h('div', { class: 'd-col' },
      h('div', { class: 'subhead', text: 'Identity' }),
      h('div', { class: 'field' }, name),
      cycle('Nation', NATIONS, Math.max(0, NATIONS.indexOf(draft.nationality)), (i) => {
        draft.nationality = NATIONS[i];
        renderCreator();
      }),
      h('div', { style: { display: 'flex', justifyContent: 'center' } }, portrait),
      h('div', { class: 'looks' }, ...LOOK_KEYS.map((k) => cycle(LOOK_LABELS[k], LOOK_OPTIONS[k], lookValue(draftLook, k), (i) => {
        draftLook = { ...draftLook, [k]: i };
        renderCreator();
      }, SWATCH_KEYS.has(k)))),
    );

    const colB = h('div', { class: 'd-col' },
      h('div', { class: 'subhead', text: 'Skills: 100 points, up to 20 each' }),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Points left' }), h('span', { class: `points${left === 0 ? ' zero' : ''}`, text: String(left) })),
      skillRows(draft, true, renderCreator),
      h('div', { class: 'subhead', text: 'Temperament: free, but locked when signed' }),
      slider('Aggression', Math.round(draft.aggression * 100), 0, 100, (v) => `${v}%`, false, (v) => {
        draft.aggression = v / 100;
        renderSide();
      }),
      slider('Risk', Math.round(draft.risk * 100), 0, 100, (v) => `${v}%`, false, (v) => {
        draft.risk = v / 100;
        renderSide();
      }),
      slider('Weight', draft.weight, 55, 95, (v) => `${v} kg`, false, (v) => {
        draft.weight = v;
        renderSide();
      }),
    );

    const radar = h('canvas', { class: 'radar' });
    const traits = h('div', { class: 'traits' });
    const factBox = h('div');
    const renderSide = (): void => {
      drawRadar(radar, draft, SKILL_CAP_AT_CREATION);
      traits.replaceChildren(...(pointsSpent(draft) >= 40 ? describe(draft) : []).map((t) => h('div', { class: t.good ? 'good' : 'bad', text: t.text })));
      if (!traits.childElementCount) traits.append(h('div', { class: 'dim', text: 'Spend points to shape the driver.' }));
      factBox.replaceChildren(facts(draft));
    };
    renderSide();
    const full = profile.drivers.length >= MAX_DRIVERS;
    const colC = h('div', { class: 'd-col' },
      h('div', { class: 'subhead', text: 'On track' }),
      radar, traits, factBox,
      h('button', {
        class: 'btn go big', text: 'Sign driver',
        disabled: full || left !== 0,
        title: full ? 'Fire a driver to free a seat' : left !== 0 ? 'Spend all 100 points first' : '',
        onclick: () => {
          const r = hireDriver(profile, draft, draftLook);
          if (!r.ok) {
            app.toast(r.reason, true);
            return;
          }
          app.commit();
          selected = profile.selectedDriver ?? 'new';
          draft = blankDriver();
          draftLook = defaultLook();
          app.toast('Driver signed. Skills are now locked.');
          render();
        },
      }),
      full ? h('div', { class: 'bad', text: 'All seats are taken' }) : null,
    );
    body.append(colA, colB, colC);
  };

  const renderDriver = (d: PlayerDriver): void => {
    const def = d.def;
    const spare = pointsAvailable(def);
    mainTitle.textContent = def.name;
    mainNote.textContent = `${def.racesCompleted} races   next point in ${10 - (def.racesCompleted % 10)}`;
    body.replaceChildren();

    const portrait = h('canvas', { class: 'portrait large' });
    drawPortrait(portrait, d.look);
    const isRace = profile.selectedDriver === def.id;
    const colA = h('div', { class: 'd-col' },
      h('div', { class: 'subhead', text: 'Identity' }),
      h('div', { style: { display: 'flex', justifyContent: 'center' } }, portrait),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Name' }), h('span', { class: 'gold', text: def.name })),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Code' }), h('span', { text: def.code })),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Nation' }), h('span', { text: def.nationality })),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Weight' }), h('span', { text: `${def.weight} kg` })),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Career points' }), h('span', { text: String(pointsAllowed(def)) })),
      h('button', { class: 'btn go', text: isRace ? 'Race driver' : 'Use in race', disabled: isRace, onclick: () => {
        profile.selectedDriver = def.id;
        app.commit();
        render();
      } }),
      h('button', { class: 'btn warn', text: 'Fire driver', onclick: () => {
        app.confirm(`Fire ${def.name}? This cannot be undone.`, 'Fire driver', () => {
          fireDriver(profile, def.id);
          app.commit();
          selected = profile.drivers[0]?.def.id ?? 'new';
          render();
        }, true);
      } }),
    );
    const colB = h('div', { class: 'd-col' },
      h('div', { class: 'subhead', text: profile.admin ? 'Skills: unlocked in test mode' : 'Skills: locked. Earned points can only be added' }),
      h('div', { class: 'field' }, h('span', { class: 'dim', text: 'Points to spend' }), h('span', { class: `points${spare === 0 ? ' zero' : ''}`, text: String(spare) })),
      skillRows(def, false, () => {
        app.commit();
        render();
      }, profile.admin),
      h('div', { class: 'subhead', text: profile.admin ? 'Temperament: unlocked in test mode' : 'Temperament: locked' }),
      slider('Aggression', Math.round(def.aggression * 100), 0, 100, (v) => `${v}%`, !profile.admin, (v) => {
        def.aggression = v / 100;
        app.commit();
      }),
      slider('Risk', Math.round(def.risk * 100), 0, 100, (v) => `${v}%`, !profile.admin, (v) => {
        def.risk = v / 100;
        app.commit();
      }),
      profile.admin ? slider('Weight', def.weight, 55, 95, (v) => `${v} kg`, false, (v) => {
        def.weight = v;
        app.commit();
      }) : null,
      profile.admin ? h('button', { class: 'btn', text: 'Test mode: add 10 races of experience', onclick: () => {
        def.racesCompleted += 10;
        app.commit();
        render();
      } }) : null,
    );
    const radar = h('canvas', { class: 'radar' });
    drawRadar(radar, def, skillCap(def));
    const traits = h('div', { class: 'traits' }, ...describe(def).map((t) => h('div', { class: t.good ? 'good' : 'bad', text: t.text })));
    body.append(colA, colB, h('div', { class: 'd-col' }, h('div', { class: 'subhead', text: 'On track' }), radar, traits, facts(def)));
  };

  const render = (): void => {
    renderRoster();
    const d = profile.drivers.find((x) => x.def.id === selected);
    if (d) renderDriver(d);
    else {
      selected = 'new';
      renderCreator();
    }
  };

  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  app.garage.setViewShift(0);
  render();
  return { root };
}
