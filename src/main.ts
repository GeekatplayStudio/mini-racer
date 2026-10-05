/**
 * MiniRacer
 * Copyright (c) 2026 Geekatplay Studio, Vladimir Chopine. All rights reserved.
 */
import '@fontsource/press-start-2p';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import * as THREE from 'three';
import { Sound } from './audio/sound';
import './ui/hud.css';
import './ui/app.css';
import { LIVERIES } from './data/cars';
import { BRANDS_HATCH_INDY, TRACKS } from './data/tracks';
import { chassisName, generateBuild } from './game/build';
import {
  DISTANCES,
  LocalStore,
  MemoryStore,
  Profile,
  ProfileStore,
  addPhoto,
  entryFee,
  hireDriver,
  newProfile,
  payEntry,
  prizeMoney,
  recordRace,
  settleRace,
} from './game/profile';
import { RaceSession, createPlayerRace, createQuickRace } from './game/raceSetup';
import { prepareTrack } from './game/trackCache';
import { GarageView } from './render/garageView';
import { RaceView } from './render/raceView';
import { SKILLS, Skill } from './sim/driver';
import { Command, SIM_DT } from './sim/race';
import { Rng } from './sim/rng';
import { Surface } from './sim/track';
import type { TrackDef } from './sim/track';
import type { App, Screen, ScreenId } from './ui/appTypes';
import { h, money } from './ui/dom';
import { mountDrivers } from './ui/driverScreen';
import { mountGarage } from './ui/garageScreen';
import { mountHistory } from './ui/historyScreen';
import { mountHome } from './ui/homeScreen';
import { OnlineRace, mountOnline, noteProfileChanged } from './ui/onlineScreen';
import { Hud } from './ui/hud';
import { defaultLook } from './ui/portrait';
import { COMMANDS } from './ui/radio';
import { openTeamTools } from './ui/teamTools';
import { createStatus, iconButton, setIcon, tabButton } from './ui/topbar';
import { mountTune } from './ui/tuneScreen';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

const numberParam = (name: string, fallback: number): number => {
  const raw = params.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const GRID_SIZE = 10;

/** A ready-made team for demos and tests: `?fixture=built`. Never saved. */
function fixtureProfile(): Profile {
  const p = newProfile();
  const rng = new Rng(7);
  const car = generateBuild(rng, 3, { ...LIVERIES[0] }, 'fixture-car');
  p.cars.push(car);
  p.selectedCar = car.id;
  const skills = {} as Record<Skill, number>;
  SKILLS.forEach((s, i) => (skills[s] = i < 4 ? 9 : 8));
  hireDriver(p, { id: 'fixture-driver', name: 'Alex Fixture', code: '', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0 }, defaultLook());
  return p;
}

const fixture = params.get('fixture');
const store: ProfileStore = fixture ? new MemoryStore() : new LocalStore();
const profile: Profile = fixture === 'built' ? fixtureProfile() : (store.load() ?? newProfile());
for (const key of ['track', 'distance', 'wear', 'pit', 'traffic', 'hazards', 'weather'] as const) {
  // Test hooks: preset the race rules from the address bar.
  const v = params.get(key);
  if (v === null) continue;
  if (key === 'track') profile.prefs.trackId = v;
  else if (key === 'distance') profile.prefs.distance = Number(v);
  else if (key === 'wear') profile.prefs.wearScale = Number(v);
  else if (key === 'pit') profile.prefs.pitMode = v === 'manual' ? 'manual' : 'auto';
  else if (key === 'hazards') profile.prefs.hazards = Number(v);
  else if (key === 'weather') profile.prefs.weather = v === 'rain' || v === 'snow' ? v : 'clear';
  else profile.prefs.traffic = v === '1';
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const garage = new GarageView(renderer, canvas);
const ref = prepareTrack(BRANDS_HATCH_INDY);

// --- Shell: top bar, screens, toast, dialogs -----------------------------------
let screenId: ScreenId = 'home';
let screen: Screen | null = null;
const moneyLabel = h('span', { class: 'money' });
const tabs = new Map<ScreenId, HTMLElement>();
const tab = (id: ScreenId, label: string): HTMLElement => {
  const node = tabButton(id, label, () => app.go(id));
  tabs.set(id, node);
  return node;
};
// Test mode sits behind the team login; the button only shows a key.
const toolsBtn = iconButton('key', 'Team tools', () => openTeamTools(app, () => app.go(screenId)), 'tools');
const sound = new Sound();
const soundBtn = iconButton('sound', 'Sound on or off (M)', () => toggleSound(), 'sound');
function showSound(): void {
  setIcon(soundBtn, sound.muted ? 'mute' : 'sound');
  soundBtn.setAttribute('aria-label', sound.muted ? 'Sound off' : 'Sound on');
  soundBtn.classList.toggle('on', !sound.muted);
}
function toggleSound(): void {
  sound.unlock();
  const muted = sound.toggle();
  showSound();
  if (hud) hud.flash(muted ? 'Sound off' : 'Sound on', 'small', 1.2);
  else app.toast(muted ? 'Sound off' : 'Sound on');
}
showSound();
const status = createStatus({ profile, ref, go: (id) => app.go(id) });
const topbar = h('div', { class: 'topbar' },
  h('span', { class: 'brand', title: 'MiniRacer by Geekatplay Studio, Vladimir Chopine' },
    h('span', { class: 'logo', text: 'MiniRacer' }),
    h('span', { class: 'by', text: 'Geekatplay Studio' }),
  ),
  tab('home', 'Race'), tab('garage', 'Garage'), tab('tune', 'Tune'), tab('drivers', 'Drivers'), tab('history', 'History'), tab('online', 'Online'),
  h('span', { class: 'spacer' }),
  status.root,
  moneyLabel,
  soundBtn,
  toolsBtn,
);
const screenHost = h('div');
const toastHost = h('div');
const modalHost = h('div', { class: 'modal-host hidden' });
uiRoot.append(screenHost, topbar, toastHost);
document.body.append(modalHost);
let toastTimer = 0;
let modalYes: (() => void) | null = null;

function closeModal(): void {
  modalHost.classList.add('hidden');
  modalHost.replaceChildren();
  modalYes = null;
  if (session) paused = false;
}

// --- Race state ---------------------------------------------------------------
let session: RaceSession | null = null;
let view: RaceView | null = null;
let hud: Hud | null = null;
let quickSeed = numberParam('seed', 2026);
let quickMode = false;
/** A race the game server runs; this page only shows it. */
let online: OnlineRace | null = null;
let timeScale = 1;
let paused = false;
let accumulator = 0;
let settled: { prize: number; position: number; photo: string | null } | null = null;
let raceDriverId = '';
let raceFee = 0;
let finishShot: string | null = null;
let wantFinishShot = false;

function layout(): void {
  const w = window.innerWidth, hgt = window.innerHeight;
  if (view) view.resize(w, hgt);
  else garage.resize(w, hgt);
  // One layout unit: the screens are designed on a 640 x 360 grid and scale smoothly with the window.
  const u = Math.max(1.35, Math.min(w / 640, hgt / 360));
  const style = document.documentElement.style;
  const px = (v: number): string => `${Math.round(v * 100) / 100}px`;
  style.setProperty('--u', px(u));
  style.setProperty('--ps', px(Math.max(9, u * 4.3)));
  style.setProperty('--fs', px(Math.max(10, u * 4.8)));
  style.setProperty('--fm', px(u * 6.4));
  style.setProperty('--fl', px(u * 9));
  style.setProperty('--fx', px(u * 13));
}

function expose(): void {
  // For end-to-end tests and debugging.
  (window as unknown as { miniracer: unknown }).miniracer = { session, view, profile, garage, screen: screenId };
}

const currentTrack = (): TrackDef => TRACKS.find((t) => t.id === profile.prefs.trackId) ?? TRACKS[0];

const app: App = {
  profile,
  ref,
  garage,
  commit(): void {
    store.save(profile);
    noteProfileChanged(profile);
    moneyLabel.textContent = profile.admin ? 'Test mode: free' : money(profile.money);
    moneyLabel.classList.toggle('test', profile.admin);
    toolsBtn.classList.toggle('on', profile.admin);
    toolsBtn.title = profile.admin ? 'Team tools: test mode is on' : 'Team tools';
    status.refresh();
  },
  go(id: ScreenId): void {
    screen?.dispose?.();
    screenId = id;
    for (const [key, node] of tabs) node.classList.toggle('on', key === id);
    screen =
      id === 'garage' ? mountGarage(app)
      : id === 'tune' ? mountTune(app)
      : id === 'drivers' ? mountDrivers(app)
      : id === 'history' ? mountHistory(app)
      : id === 'online' ? mountOnline(app)
      : mountHome(app, GRID_SIZE);
    screenHost.replaceChildren(screen.root);
    expose();
  },
  toast(message: string, bad = false): void {
    toastHost.replaceChildren(h('div', { class: `toast${bad ? ' bad' : ''}`, text: message }));
    toastTimer = 2.8;
  },
  confirm(message: string, yesLabel: string, onYes: () => void, danger = false): void {
    modalYes = () => {
      closeModal();
      onYes();
    };
    modalHost.replaceChildren(h('div', { class: 'pane modal' },
      h('div', { class: 'title' }, 'Confirm'),
      h('div', { class: 'modal-body' },
        h('div', { class: 'modal-text', text: message }),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
          h('button', { class: `btn ${danger ? 'warn' : 'go'}`, text: yesLabel, onclick: () => modalYes?.() }),
        ),
      ),
    ));
    modalHost.classList.remove('hidden');
  },
  dialog(title: string, content: Node[], closeButton = true): void {
    modalYes = null;
    modalHost.replaceChildren(h('div', { class: 'pane modal wide' },
      h('div', { class: 'title' }, title),
      h('div', { class: 'modal-body' }, ...content, closeButton ? h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Close', onclick: closeModal })) : null),
    ));
    modalHost.classList.remove('hidden');
  },
  closeDialog(): void {
    closeModal();
  },
  enterOnline(race: OnlineRace): void {
    closeModal();
    enterRace(race.session, false, race);
  },
  startRace(practice: boolean): void {
    const car = profile.cars.find((c) => c.id === profile.selectedCar);
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    if (!car || !driver) return;
    const track = currentTrack();
    const prefs = profile.prefs;
    const made = createPlayerRace({
      trackDef: track,
      car,
      driver: driver.def,
      gridSize: GRID_SIZE,
      laps: Math.max(1, numberParam('laps', track.defaultLaps * (DISTANCES[prefs.distance]?.laps ?? 1))),
      seed: (Date.now() & 0x7fffffff) ^ (profile.races * 7919),
      practice,
      traffic: prefs.traffic,
      pitMode: prefs.pitMode,
      wearScale: prefs.wearScale,
      hazards: prefs.hazards,
      weather: prefs.weather,
    });
    if (!made) {
      app.toast('That car is not race legal', true);
      return;
    }
    raceFee = practice ? 0 : payEntry(profile, track).paid;
    app.commit();
    raceDriverId = driver.def.id;
    made.entries[made.playerCar].look = driver.look;
    enterRace(made, false);
  },
};

function enterRace(made: RaceSession, quick: boolean, net: OnlineRace | null = null): void {
  leaveRaceViews();
  online = net;
  session = made;
  quickMode = quick;
  settled = null;
  finishShot = null;
  wantFinishShot = false;
  timeScale = 1;
  paused = false;
  accumulator = 0;
  view = new RaceView(renderer, made);
  const cam = params.get('cam');
  if (cam === 'pov') view.cycleCamera();
  if (cam === 'overview') {
    view.cycleCamera();
    view.cycleCamera();
  }
  const hints: [string, string][] = net
    // Everyone shares one race clock online: no pausing, no time warp.
    ? [['Tab', 'Car'], ['C', 'Camera'], ['M', 'Sound'], ['Esc', 'Leave']]
    : [['Tab', 'Car'], ['C', 'Camera'], ['1 2 3', 'Speed'], ['P', 'Pause'], ['M', 'Sound'], quick ? ['R', 'New race'] : ['Esc', 'Leave']];
  const race = made.race;
  if (net) hud = new Hud(hudRoot, made, hints, () => net.footer(backToGarage), (command: Command) => net.command(command));
  else hud = new Hud(hudRoot, made, hints, quick ? undefined : resultFooter, quick ? undefined : (command: Command) => race.command(made.playerCar, command));
  uiRoot.style.display = 'none';
  hudRoot.style.display = '';
  layout();
  const skip = net ? 0 : numberParam('skip', 0);
  for (let i = 0; i < skip / SIM_DT && race.phase !== 'finished'; i++) race.step();
  race.events.length = 0;
  expose();
}

function leaveRaceViews(): void {
  view?.dispose();
  hud?.dispose();
  view = null;
  hud = null;
  session = null;
}

function backToGarage(): void {
  leaveRaceViews();
  uiRoot.style.display = '';
  hudRoot.style.display = 'none';
  layout();
  app.commit();
  const wasOnline = online;
  online = null;
  wasOnline?.leave();
  app.go(wasOnline ? 'online' : 'home');
}

/** Writes the session into the history, banks the prize and keeps the finish photo. Runs once. */
function settle(forfeit = false): void {
  const s = session;
  if (!s || settled) return;
  const me = s.race.cars[s.playerCar];
  const classified = me.finished && !forfeit;
  const position = me.position;
  let prize = 0;
  if (s.counts) {
    if (classified) prize = settleRace(profile, raceDriverId, s.trackDef, position);
    else {
      // A retirement still counts as a start for the team and the driver.
      profile.races += 1;
      const d = profile.drivers.find((x) => x.def.id === raceDriverId);
      if (d) d.def.racesCompleted += 1;
    }
  }
  const car = profile.cars.find((c) => c.id === profile.selectedCar);
  const photo = finishShot ? addPhoto(profile, 'finish', finishShot, `${me.driver.name} takes the flag at ${s.trackDef.publicName}`) : null;
  recordRace(profile, {
    date: Date.now(),
    trackId: s.trackDef.id,
    practice: !s.counts,
    position: classified ? position : 0,
    grid: s.playerGrid,
    entries: s.race.cars.length,
    laps: s.race.laps,
    lapsDone: s.race.lapsDone(me),
    bestLap: Number.isFinite(me.bestLap) ? me.bestLap : 0,
    raceTime: me.finishTime,
    pitStops: me.pitStops,
    fee: raceFee,
    prize,
    car: car ? chassisName(car) : me.spec.name,
    driver: me.driver.name,
    driverId: raceDriverId,
    retired: classified ? '' : forfeit ? 'withdrew' : me.retireReason === 'fuel' ? 'out of fuel' : me.retireReason === 'tyres' ? 'tyre failure' : 'not classified',
    photo: photo?.id,
  });
  settled = { prize, position: classified ? position : 0, photo: finishShot };
  app.commit();
}

/** Builds the panel under the result table. */
function resultFooter(): HTMLElement {
  const s = session;
  const box = h('div', { class: 'reward' });
  if (!s) return box;
  settle();
  const me = s.race.cars[s.playerCar];
  if (settled?.photo) {
    const img = h('img', { class: 'finish-photo' });
    img.src = settled.photo;
    img.alt = 'Finish-line photo';
    box.append(img);
  }
  if (s.counts) {
    box.append(
      h('div', { text: settled?.position ? `You finished P${settled.position}` : `Did not finish: ${me.retireReason === 'fuel' ? 'out of fuel' : me.retireReason === 'tyres' ? 'tyre failure' : 'not classified'}` }),
      h('div', { class: 'prize', text: `Prize ${money(settled?.prize ?? 0)}` }),
      h('div', { class: 'dim', text: profile.admin ? 'Test mode' : `Balance ${money(profile.money)}` }),
    );
  } else {
    box.append(h('div', { text: me.bestLap < Infinity ? `Best lap ${me.bestLap.toFixed(3)} s` : 'No lap completed' }), h('div', { class: 'dim', text: 'Practice: no fee, no prize' }));
  }
  box.append(h('button', { class: 'btn go', text: 'Continue', onclick: backToGarage }));
  return box;
}

function startQuickRace(): void {
  enterRace(createQuickRace({
    trackDef: TRACKS.find((t) => t.id === params.get('track')) ?? BRANDS_HATCH_INDY,
    gridSize: numberParam('grid', 10),
    laps: numberParam('laps', BRANDS_HATCH_INDY.defaultLaps),
    seed: quickSeed,
    playerGrid: numberParam('player', 5),
  }), true);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (session && view && hud) {
    const race = session.race;
    if (online) {
      online.advance(dt);
    } else if (!paused) {
      accumulator += dt * timeScale;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < 240) {
        race.step();
        accumulator -= SIM_DT;
        steps++;
      }
      if (steps === 240) accumulator = 0;
    }
    if (race.events.length) {
      // The photographer is waiting at the line for the player's car.
      if (race.events.some((e) => e.type === 'finish' && e.car === session?.playerCar)) wantFinishShot = true;
      sound.events(race.events, view.focusCar, session.playerCar);
      hud.handleEvents(race.events, view.focusCar);
      race.events.length = 0;
    }
    const heard = race.cars[view.focusCar];
    if (paused || heard.parked) sound.follow(null, null);
    else sound.follow(heard.spec, heard.state, heard.surface === Surface.Asphalt || heard.surface === Surface.Kerb);
    view.update(paused ? 0 : dt * timeScale);
    if (wantFinishShot && !quickMode) {
      wantFinishShot = false;
      const mode = view.cameraMode;
      const focus = view.focusCar;
      view.focusCar = session.playerCar;
      while (view.cameraMode !== 'chase') view.cycleCamera();
      view.update(0);
      finishShot = view.capture();
      view.focusCar = focus;
      while (view.cameraMode !== mode) view.cycleCamera();
      view.update(0);
    }
    view.render();
    hud.update(dt, view.focusCar, timeScale, paused);
  } else {
    sound.follow(null, null);
    garage.update(dt);
    garage.render();
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastHost.replaceChildren();
    }
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', layout);
// Sound may only start after the player has clicked or pressed something.
window.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if ((e.target as HTMLElement | null)?.closest?.('button')) sound.click();
});
window.addEventListener('keydown', (e) => {
  sound.unlock();
  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    toggleSound();
    return;
  }
  if (!modalHost.classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'Enter') modalYes?.();
    return;
  }
  if (!session || !view) return;
  const count = session.race.cars.length;
  const order = COMMANDS.find((c) => c.key.toLowerCase() === e.key.toLowerCase());
  if (order && !quickMode && !e.ctrlKey && !e.metaKey) {
    hud?.order(order.id);
    return;
  }
  switch (e.key) {
    case 'Tab': {
      e.preventDefault();
      // Step through the field in race order.
      const pos = session.race.cars[view.focusCar].position - 1;
      view.focusCar = session.race.order[(pos + (e.shiftKey ? 1 : count - 1)) % count].id;
      break;
    }
    case 'Home':
      view.focusCar = session.playerCar;
      break;
    case 'c':
    case 'C':
      view.cycleCamera();
      break;
    case 'p':
    case 'P':
    case ' ':
      if (!online) paused = !paused;
      break;
    case '1':
      if (!online) timeScale = 1;
      break;
    case '2':
      if (!online) timeScale = 2;
      break;
    case '3':
      if (!online) timeScale = 4;
      break;
    case '4':
      if (!online) timeScale = 8;
      break;
    case 'r':
    case 'R':
      if (quickMode) {
        quickSeed += 1;
        startQuickRace();
      }
      break;
    case 'Escape': {
      if (quickMode) break;
      const over = session.race.phase === 'finished';
      if (online) {
        // The car races on under its driver; the team gives up the result.
        if (over) backToGarage();
        else app.confirm('Leave the race? Your car keeps racing without its pit wall, and you get no prize.', 'Leave', backToGarage, true);
        break;
      }
      if (over || !session.counts) {
        settle(!over);
        backToGarage();
        break;
      }
      paused = true;
      app.confirm(
        `Retire from the race? The entry fee of ${money(entryFee(session.trackDef))} is not refunded and the prize (up to ${money(prizeMoney(session.trackDef, 1))}) is lost.`,
        'Retire',
        () => {
          settle(true);
          backToGarage();
        },
        true,
      );
      break;
    }
  }
});
modalHost.addEventListener('click', (e) => {
  if (e.target === modalHost) {
    closeModal();
    paused = false;
  }
});

hudRoot.style.display = 'none';
app.commit();
if (params.get('quick') === '1') {
  startQuickRace();
} else {
  layout();
  const start = params.get('screen');
  app.go(start === 'garage' || start === 'drivers' || start === 'tune' || start === 'history' || start === 'online' ? start : 'home');
}
requestAnimationFrame(frame);
