import { TRACKS } from '../data/tracks';
import { chassisName, deriveCar } from '../game/build';
import { DISTANCES, HAZARD_LEVELS, WEAR_SCALES, addPhoto, entryFee, prizeMoney } from '../game/profile';
import { prepareTrack } from '../game/trackCache';
import type { TrackDef } from '../sim/track';
import type { App, Screen } from './appTypes';
import { h, hexColor, lapText, money } from './dom';
import { trackTitle } from './hud';
import { drawPortrait, lookColor, lookValue } from './portrait';

/** Small outline of a circuit for its card. */
function drawOutline(canvas: HTMLCanvasElement, def: TrackDef): void {
  const W = 96, H = 60;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { track } = prepareTrack(def);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i]);
    maxX = Math.max(maxX, track.x[i]);
    minY = Math.min(minY, track.y[i]);
    maxY = Math.max(maxY, track.y[i]);
  }
  const scale = Math.min((W - 10) / (maxX - minX), (H - 10) / (maxY - minY));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const step = Math.max(1, Math.floor(track.n / 300));
  for (let i = 0; i < track.n; i += step) {
    const x = track.x[i] * scale + ox, y = track.y[i] * scale + oy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(track.x[0] * scale + ox - 2, track.y[0] * scale + oy - 2, 4, 4);
}

/** Team overview and race entry: pick the car, driver, circuit and rules, then go. */
export function mountHome(app: App, gridSize: number): Screen {
  const { profile } = app;
  const prefs = profile.prefs;
  const body = h('div', { class: 'home-body scroll' });
  const pane = h('div', { class: 'pane home' }, h('div', { class: 'title' }, 'Race entry', h('span', { text: `${profile.races} races  ${profile.wins} wins` })), body);
  const studio = h('div', { class: 'studio hidden' });
  const root = h('div', {}, pane, studio);

  const choice = <T>(label: string, options: readonly { label: string; value: T }[], current: T, set: (v: T) => void): HTMLElement =>
    h('div', { class: 'choice' }, h('span', { class: 'dim', text: label }),
      ...options.map((o) => h('button', { class: `btn${o.value === current ? ' on' : ''}`, text: o.label, onclick: () => {
        set(o.value);
        app.commit();
        render();
      } })));

  const showDriver = (): void => {
    const d = profile.drivers.find((x) => x.def.id === profile.selectedDriver);
    app.garage.setDriver(d ? {
      skin: lookColor(d.look, 'skin'), hair: lookColor(d.look, 'hairColor'), suit: lookColor(d.look, 'suit'), helmet: lookColor(d.look, 'helmet'),
      female: lookValue(d.look, 'sex') === 1, hairStyle: lookValue(d.look, 'hair'), hat: lookValue(d.look, 'hat'), glasses: lookValue(d.look, 'glasses'),
    } : null);
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
        app.garage.setViewShift(0.26, -0.04);
        app.garage.resetView();
      } }),
    );
  };

  const render = (): void => {
    body.replaceChildren();
    const legal = new Map(profile.cars.map((c) => [c.id, deriveCar(c, app.ref)]));
    const car = profile.cars.find((c) => c.id === profile.selectedCar && legal.get(c.id)?.legal);
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    const track = TRACKS.find((t) => t.id === prefs.trackId) ?? TRACKS[0];
    app.garage.setCar(profile.cars.find((c) => c.id === profile.selectedCar) ?? profile.cars[0] ?? null);
    showDriver();

    body.append(h('div', { class: 'subhead', text: '1  Car' }));
    if (!profile.cars.length) {
      body.append(h('div', { class: 'pick-row' }, h('div', { class: 'pick', onclick: () => app.go('garage') }, h('div', {}, h('b', { text: 'No car yet' }), 'Open the garage and build one'))));
    } else {
      const row = h('div', { class: 'pick-row' });
      for (const c of profile.cars) {
        const d = legal.get(c.id);
        row.append(h('div', {
          class: `pick${car?.id === c.id ? ' on' : ''}${d?.legal ? '' : ' off'}`,
          onclick: () => {
            if (!d?.legal) {
              app.toast('That car is not race legal yet', true);
              return;
            }
            profile.selectedCar = c.id;
            app.commit();
            render();
          },
        },
          h('div', { class: 'stripe', style: { background: hexColor(c.livery.base) } }),
          h('div', { style: { minWidth: '0' } },
            h('b', { text: chassisName(c) }),
            d?.legal && d.stats ? `Rating ${d.stats.rating}  ${d.stats.powerHp.toFixed(0)} hp  lap ${lapText(d.stats.lapTime)}` : `Not legal: ${d?.missing.length ?? 0} parts missing`,
          ),
        ));
      }
      body.append(row);
    }

    body.append(h('div', { class: 'subhead', text: '2  Driver' }));
    if (!profile.drivers.length) {
      body.append(h('div', { class: 'pick-row' }, h('div', { class: 'pick', onclick: () => app.go('drivers') }, h('div', {}, h('b', { text: 'No driver yet' }), 'Open drivers and sign one'))));
    } else {
      const row = h('div', { class: 'pick-row' });
      for (const d of profile.drivers) {
        const canvas = h('canvas', { class: 'portrait' });
        drawPortrait(canvas, d.look);
        row.append(h('div', {
          class: `pick${driver?.def.id === d.def.id ? ' on' : ''}`,
          onclick: () => {
            profile.selectedDriver = d.def.id;
            app.commit();
            render();
          },
        }, canvas, h('div', { style: { minWidth: '0' } }, h('b', { text: d.def.name }), `${d.def.nationality}  ${d.def.racesCompleted} races`)));
      }
      body.append(row);
    }

    body.append(h('div', { class: 'subhead', text: `3  Circuit   ${TRACKS.length} available` }));
    const tracks = h('div', { class: 'track-row' });
    for (const t of TRACKS) {
      const canvas = h('canvas', { class: 'outline' });
      drawOutline(canvas, t);
      tracks.append(h('div', {
        class: `track${t.id === track.id ? ' on' : ''}`,
        onclick: () => {
          prefs.trackId = t.id;
          app.commit();
          render();
        },
      }, canvas,
        h('b', { text: trackTitle(t) }),
        h('span', { text: `${t.country}  ${(t.lengthM / 1000).toFixed(2)} km` }),
        h('span', { class: 'gold', text: '★'.repeat(t.difficulty) }),
        h('span', { class: 'dim', text: `Win ${money(prizeMoney(t, 1))}` }),
      ));
    }
    body.append(tracks);

    const laps = track.defaultLaps * DISTANCES[prefs.distance].laps;
    const fee = entryFee(track);
    body.append(
      h('div', { class: 'subhead', text: '4  Rules' }),
      choice('Distance', DISTANCES.map((d, i) => ({ label: `${d.label} ${track.defaultLaps * d.laps} laps`, value: i })), prefs.distance, (v) => {
        prefs.distance = v;
      }),
      choice('Tyre and fuel use', WEAR_SCALES.map((w) => ({ label: w.label, value: w.scale })), prefs.wearScale, (v) => {
        prefs.wearScale = v;
      }),
      choice('Pit stops', [{ label: 'Driver decides', value: 'auto' as const }, { label: 'Pit wall calls (you)', value: 'manual' as const }], prefs.pitMode, (v) => {
        prefs.pitMode = v;
      }),
      choice('Road hazards', HAZARD_LEVELS.map((l) => ({ label: l.label, value: l.max })), prefs.hazards, (v) => {
        prefs.hazards = v;
      }),
      choice('Practice', [{ label: 'Alone on track', value: false }, { label: 'With other cars', value: true }], prefs.traffic, (v) => {
        prefs.traffic = v;
      }),
      h('div', { class: 'prizes' },
        h('span', { class: 'gold', text: `Entry fee ${profile.admin ? 'free (test mode)' : money(fee)}` }),
        h('span', { text: `${laps} laps  ${((laps * track.lengthM) / 1000).toFixed(1)} km  ${gridSize} cars` }),
        ...[1, 2, 3, 5, 10].map((p) => h('span', { text: `P${p} ${money(prizeMoney(track, p))}` })),
      ),
    );
    if (prefs.pitMode === 'manual') {
      body.append(h('div', { class: 'dim', text: 'You call the stops. If the fuel runs out or a tyre fails before you do, the car stops for good.' }));
    }

    const ready = !!car && !!driver;
    const broke = !profile.admin && profile.money < fee;
    body.append(
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Team photo', disabled: !profile.cars.length, onclick: openStudio }),
        h('button', { class: 'btn', text: 'Practice (free)', disabled: !ready, onclick: () => app.startRace(true) }),
        h('button', { class: 'btn go big', text: broke ? 'Race (wildcard entry)' : profile.admin ? 'Race' : `Race  -${money(fee)}`, disabled: !ready, onclick: () => app.startRace(false) }),
      ),
      h('div', { class: 'dim', style: { textAlign: 'center' }, text: ready
        ? (broke ? 'Short of the fee: the organisers let you in on a wildcard.' : 'Grid positions are set by expected lap time.')
        : 'You need a race-legal car and a signed driver to enter.' }),
    );
  };

  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  // The entry panel sits on the left; show the car in the space to its right.
  app.garage.setViewShift(0.26, -0.04);
  app.garage.resetView();
  render();
  return { root, dispose: () => app.garage.setDriver(null) };
}
