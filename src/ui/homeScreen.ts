import { TRACKS } from '../data/tracks';
import { chassisName, deriveCar } from '../game/build';
import { DISTANCES, HAZARD_LEVELS, WEATHERS, WEAR_SCALES, addPhoto, entryFee, prizeMoney } from '../game/profile';
import type { TrackDef } from '../sim/track';
import type { App, Screen } from './appTypes';
import { h, hexColor, lapText, money } from './dom';
import { trackTitle } from './hud';
import { IconName, icon } from './icons';
import { drawPortrait, lookColor, lookValue } from './portrait';
import { ratingGrade } from './specSheet';
import { fact, paneTitle, stars, subhead } from './widgets';

const WEATHER_ICONS: Record<string, IconName> = { clear: 'sun', rain: 'rain', snow: 'snow' };

/** The centre line as a smooth closed curve through the control points. */
function outlinePath(def: TrackDef): [number, number][] {
  const p = def.points;
  const n = p.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n], d = p[(i + 2) % n];
    for (let s = 0; s < 6; s++) {
      const t = s / 6, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t3)) as [number, number]);
    }
  }
  return out;
}

/** Outline of a circuit: a thin line for a card, a road with a start line for the preview. */
function drawOutline(canvas: HTMLCanvasElement, def: TrackDef, W: number, H: number, road: boolean): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pts = outlinePath(def);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = road ? 12 : 6;
  const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
  const path = (): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * scale + ox, y * scale + oy) : ctx.lineTo(x * scale + ox, y * scale + oy)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = road ? 7 : 2;
  path();
  ctx.stroke();
  if (road) {
    ctx.strokeStyle = '#3a3f66';
    ctx.lineWidth = 4;
    path();
    ctx.stroke();
  }
  const sx = Math.round(pts[0][0] * scale + ox), sy = Math.round(pts[0][1] * scale + oy);
  ctx.fillStyle = '#ffd23f';
  if (road) ctx.fillRect(sx - 1, sy - 6, 3, 12);
  else ctx.fillRect(sx - 2, sy - 2, 4, 4);
}

// Outlines never change, so each is drawn once.
const cardArt = new Map<string, HTMLCanvasElement>();
const previewArt = new Map<string, HTMLCanvasElement>();
function art(cache: Map<string, HTMLCanvasElement>, def: TrackDef, className: string, W: number, H: number, road: boolean): HTMLCanvasElement {
  let canvas = cache.get(def.id);
  if (!canvas) {
    canvas = h('canvas', { class: className });
    drawOutline(canvas, def, W, H, road);
    cache.set(def.id, canvas);
  }
  return canvas;
}

/** Team overview and race entry: pick the car, driver, circuit and rules, then go. */
export function mountHome(app: App, gridSize: number): Screen {
  const { profile } = app;
  const prefs = profile.prefs;
  const team = h('div', { class: 'home-col scroll' });
  const circuit = h('div', { class: 'home-col home-circuit' });
  const foot = h('div', { class: 'home-foot' });
  const record = h('span', { class: 'note', text: `${profile.races} races  ${profile.wins} wins` });
  const pane = h('div', { class: 'pane home' }, paneTitle('flag', 'Race entry', record), h('div', { class: 'home-grid' }, team, circuit), foot);
  const studio = h('div', { class: 'studio hidden' });
  const root = h('div', {}, pane, studio);
  let gridScroll = 0;
  let firstRender = true;

  /** One rule: a label and a row of options, one of them on. */
  const choice = <T extends string | number | boolean>(
    rule: string, label: string, options: readonly { label: string; value: T; title?: string; icon?: IconName }[], current: T, set: (v: T) => void,
  ): HTMLElement =>
    h('div', { class: 'choice', data: { rule } }, h('span', { class: 'choice-label', text: label }),
      h('div', { class: 'seg' }, ...options.map((o) => h('button', {
        class: `btn${o.value === current ? ' on' : ''}`, title: o.title, data: { value: String(o.value) },
        onclick: () => {
          set(o.value);
          app.commit();
          render();
        },
      }, o.icon ? icon(o.icon) : null, o.label))));

  const showDriver = (): void => {
    const d = profile.drivers.find((x) => x.def.id === profile.selectedDriver);
    app.garage.setDriver(d ? {
      skin: lookColor(d.look, 'skin'), hair: lookColor(d.look, 'hairColor'), suit: lookColor(d.look, 'suit'), helmet: lookColor(d.look, 'helmet'),
      female: lookValue(d.look, 'sex') === 1, hairStyle: lookValue(d.look, 'hair'), hat: lookValue(d.look, 'hat'), glasses: lookValue(d.look, 'glasses'),
    } : null);
  };

  const frameView = (): void => {
    // The entry panel sits on the left; show the car in the space to its right.
    app.garage.setViewShift(0.32, -0.04);
    app.garage.resetView();
    app.garage.zoom(1.3);
  };

  const openStudio = (): void => {
    pane.classList.add('hidden');
    studio.classList.remove('hidden');
    app.garage.autoRotate = false;
    app.garage.setViewShift(0, 0);
    app.garage.photoPose();
    const car = profile.cars.find((c) => c.id === profile.selectedCar);
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    studio.replaceChildren(
      h('span', { class: 'dim', text: 'Team photo   Drag to rotate, wheel to zoom, right-drag to pan' }),
      h('button', { class: 'btn go', text: 'Take photo', onclick: () => {
        // Hide the bar for the shot, capture, then bring it back.
        studio.classList.add('hidden');
        const data = app.garage.capture();
        studio.classList.remove('hidden');
        addPhoto(profile, 'team', data, `${driver?.def.name ?? 'The team'} with the ${car ? chassisName(car) : 'car'}`);
        app.commit();
        app.toast('Photo saved to the team album (History tab)');
      } }),
      h('button', { class: 'btn', text: 'Back', onclick: () => {
        studio.classList.add('hidden');
        pane.classList.remove('hidden');
        app.garage.autoRotate = true;
        frameView();
      } }),
    );
  };

  const render = (): void => {
    const legal = new Map(profile.cars.map((c) => [c.id, deriveCar(c, app.ref)]));
    const car = profile.cars.find((c) => c.id === profile.selectedCar && legal.get(c.id)?.legal);
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    const track = TRACKS.find((t) => t.id === prefs.trackId) ?? TRACKS[0];
    app.garage.setCar(profile.cars.find((c) => c.id === profile.selectedCar) ?? profile.cars[0] ?? null);
    showDriver();

    // --- Car, driver and rules ------------------------------------------------
    const teamScroll = team.scrollTop;
    team.replaceChildren(subhead('car', '1  Car', profile.cars.length ? `${profile.cars.length} in the garage` : ''));
    const cars = h('div', { class: 'pick-list' });
    if (!profile.cars.length) {
      cars.append(h('div', { class: 'pick empty', onclick: () => app.go('garage') }, icon('wrench'), h('div', { class: 'pick-text' }, h('b', { text: 'No car yet' }), h('span', { text: 'Open the garage and build one' }))));
    }
    for (const c of profile.cars) {
      const d = legal.get(c.id);
      const ok = !!d?.legal && !!d.stats;
      cars.append(h('div', {
        class: `pick${car?.id === c.id ? ' on' : ''}${ok ? '' : ' off'}`,
        onclick: () => {
          if (!ok) {
            app.toast('That car is not race legal yet', true);
            return;
          }
          profile.selectedCar = c.id;
          app.commit();
          render();
        },
      },
        h('i', { class: 'stripe', style: { background: hexColor(c.livery.base) } }),
        h('div', { class: 'pick-text' },
          h('b', { text: chassisName(c) }),
          h('span', { text: ok && d?.stats ? `${d.stats.powerHp.toFixed(0)} hp   ${d.stats.massKg.toFixed(0)} kg   lap ${lapText(d.stats.lapTime)}` : `Not legal: ${d?.missing.length ?? 0} parts missing` }),
        ),
        ok && d?.stats ? h('div', { class: 'pick-rate' }, h('b', { text: String(d.stats.rating) }), h('span', { text: `Class ${ratingGrade(d.stats.rating)}` })) : null,
      ));
    }
    team.append(cars, subhead('helmet', '2  Driver', profile.drivers.length ? `${profile.drivers.length} signed` : ''));
    const drivers = h('div', { class: 'pick-list' });
    if (!profile.drivers.length) {
      drivers.append(h('div', { class: 'pick empty', onclick: () => app.go('drivers') }, icon('helmet'), h('div', { class: 'pick-text' }, h('b', { text: 'No driver yet' }), h('span', { text: 'Open drivers and sign one' }))));
    }
    for (const d of profile.drivers) {
      const canvas = h('canvas', { class: 'portrait small' });
      drawPortrait(canvas, d.look);
      drivers.append(h('div', {
        class: `pick${driver?.def.id === d.def.id ? ' on' : ''}`,
        onclick: () => {
          profile.selectedDriver = d.def.id;
          app.commit();
          render();
        },
      }, canvas, h('div', { class: 'pick-text' }, h('b', { text: d.def.name }), h('span', { text: `${d.def.nationality}   ${d.def.racesCompleted} races` }))));
    }
    team.append(drivers, subhead('rules', '4  Rules'),
      choice('distance', 'Distance', DISTANCES.map((d, i) => ({ label: d.label, value: i, title: `${track.defaultLaps * d.laps} laps` })), prefs.distance, (v) => {
        prefs.distance = v;
      }),
      choice('weather', 'Weather', WEATHERS.map((w) => ({ label: w.label, value: w.id, icon: WEATHER_ICONS[w.id] })), prefs.weather, (v) => {
        prefs.weather = v;
      }),
      choice('wear', 'Tyre and fuel use', WEAR_SCALES.map((w) => ({ label: w.label, value: w.scale })), prefs.wearScale, (v) => {
        prefs.wearScale = v;
      }),
      choice('pit', 'Pit stops', [{ label: 'Driver decides', value: 'auto' as const }, { label: 'Pit wall calls (you)', value: 'manual' as const }], prefs.pitMode, (v) => {
        prefs.pitMode = v;
      }),
      h('div', {
        class: `dim note${prefs.pitMode === 'manual' ? '' : ' hidden'}`,
        text: 'You call the stops. If the fuel runs out or a tyre fails before you do, the car stops for good.',
      }),
      choice('hazards', 'Road hazards', HAZARD_LEVELS.map((l) => ({ label: l.label.replace(/\s*\(.*\)$/, ''), value: l.max, title: l.max ? `Up to ${l.max} on track at once` : 'No hazards' })), prefs.hazards, (v) => {
        prefs.hazards = v;
      }),
      choice('traffic', 'Practice traffic', [{ label: 'Alone on track', value: false }, { label: 'With other cars', value: true }], prefs.traffic, (v) => {
        prefs.traffic = v;
      }),
    );
    team.scrollTop = teamScroll;

    // --- Circuit ----------------------------------------------------------------
    const laps = track.defaultLaps * DISTANCES[prefs.distance].laps;
    const fee = entryFee(track);
    const best = profile.history
      .filter((r) => r.trackId === track.id && Number.isFinite(r.bestLap) && r.bestLap > 0)
      .sort((a, b) => a.bestLap - b.bestLap)[0];
    const grid = h('div', { class: 'track-grid scroll' });
    for (const t of TRACKS) {
      grid.append(h('div', {
        class: `track${t.id === track.id ? ' on' : ''}`, title: trackTitle(t),
        onclick: () => {
          prefs.trackId = t.id;
          app.commit();
          render();
        },
      }, art(cardArt, t, 'outline', 96, 54, false),
        h('b', { text: trackTitle(t) }),
        h('span', { class: 'meta' }, h('span', { text: `${t.country}  ${(t.lengthM / 1000).toFixed(1)} km` }), h('span', { class: 'gold', text: '★'.repeat(t.difficulty) })),
      ));
    }
    circuit.replaceChildren(
      subhead('circuit', '3  Circuit', `${TRACKS.length} available`),
      h('div', { class: 'track-view' },
        h('div', { class: 'track-art' }, art(previewArt, track, 'outline big', 220, 132, true)),
        h('div', { class: 'track-facts' },
          h('div', { class: 'track-name', text: trackTitle(track) }),
          h('div', { class: 'facts' },
            ...fact('Country', track.country),
            ...fact('Lap length', `${(track.lengthM / 1000).toFixed(2)} km`),
            h('span', { class: 'dim', text: 'Difficulty' }), stars(track.difficulty),
            ...fact('Race distance', `${laps} laps  ${((laps * track.lengthM) / 1000).toFixed(1)} km`),
            ...fact('Entry fee', profile.admin ? 'Free' : money(fee)),
            ...fact('Prize for the win', money(prizeMoney(track, 1)), 'good'),
            ...fact('Your lap record', best ? `${lapText(best.bestLap)}  ${best.driver}` : 'No lap yet', best ? 'gold' : 'dim'),
          ),
        ),
      ),
      h('div', { class: 'prizes' }, h('span', { class: 'dim', text: 'Prizes' }), ...[1, 2, 3, 5, 10].filter((p) => p <= gridSize).map((p) => h('span', {}, h('b', { text: `P${p}` }), money(prizeMoney(track, p))))),
      grid,
    );
    // Keep the list where the player left it; on arrival, bring the chosen circuit into view.
    if (firstRender) grid.querySelector('.track.on')?.scrollIntoView({ block: 'nearest' });
    else grid.scrollTop = gridScroll;
    grid.addEventListener('scroll', () => {
      gridScroll = grid.scrollTop;
    });
    gridScroll = grid.scrollTop;
    firstRender = false;

    // --- Summary and start ------------------------------------------------------
    const ready = !!car && !!driver;
    const broke = !profile.admin && profile.money < fee;
    const weather = WEATHERS.find((w) => w.id === prefs.weather);
    foot.replaceChildren(
      h('div', { class: 'summary' },
        h('div', { class: 'summary-main' },
          h('span', { class: 'gold', text: `Entry fee ${profile.admin ? 'free (test mode)' : money(fee)}` }),
          h('span', { text: `${laps} laps` }),
          h('span', { text: `${((laps * track.lengthM) / 1000).toFixed(1)} km` }),
          h('span', { text: `${gridSize} cars` }),
          weather ? h('span', { text: weather.label }) : null,
        ),
        h('div', { class: 'dim note', text: ready
          ? (broke ? 'Short of the fee: the organisers let you in on a wildcard.' : 'Grid positions are set by expected lap time.')
          : 'You need a race-legal car and a signed driver to enter.' }),
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', disabled: !profile.cars.length, onclick: openStudio }, icon('camera'), 'Team photo'),
        h('button', { class: 'btn', text: 'Practice (free)', disabled: !ready, onclick: () => app.startRace(true) }),
        h('button', { class: 'btn go big', text: broke ? 'Race (wildcard entry)' : profile.admin ? 'Race' : `Race  -${money(fee)}`, disabled: !ready, onclick: () => app.startRace(false) }),
      ),
    );
  };

  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  frameView();
  render();
  return { root, dispose: () => app.garage.setDriver(null) };
}
