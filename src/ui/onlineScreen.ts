import { TRACKS } from '../data/tracks';
import { chassisName } from '../game/build';
import { DISTANCES, HAZARD_LEVELS, Profile, WEAR_SCALES, WEATHERS, entryFee, prizeMoney, upgradeProfile } from '../game/profile';
import type { RaceSession } from '../game/raceSetup';
import { NetEvent, netClient } from '../net/client';
import { RaceMirror } from '../net/mirror';
import { raceLegal, sessionFromSetup, trackById } from '../net/onlineRace';
import { GRID_MAX, GRID_MIN, GameInfo, GameRules, LAPS_MAX, NAME_PATTERN, PASSWORD_MAX, PASSWORD_MIN, RoomInfo, ServerMessage } from '../net/protocol';
import type { Command, PitMode } from '../sim/race';
import type { App, Screen } from './appTypes';
import { h, money } from './dom';
import { trackTitle } from './hud';
import './online.css';

/** A race the server runs, as the shell drives it: no stepping, no pause, no time warp. */
export interface OnlineRace {
  session: RaceSession;
  /** Moves the picture on by one frame. */
  advance(dt: number): void;
  /** A pit-wall order for the player's own car. */
  command(command: Command): void;
  /** What sits under the result table; `exit` returns to the menus. */
  footer(exit: () => void): HTMLElement;
  /** The player leaves the race screen. Before the flag this gives up the result. */
  leave(): void;
}

type Result = Extract<ServerMessage, { t: 'result' }>;

const SYNC_KEY = 'miniracer.online.sync';
/** Most events kept waiting for the frame loop, e.g. while the tab is in the background. */
const EVENT_BACKLOG = 400;

// --- Shared state: lives across screen changes and through a race -----------------

const client = netClient();
let shellApp: App | null = null;
let games: GameInfo[] = [];
let room: RoomInfo | null = null;
let active: OnlineRace | null = null;
/** In a room or a race: the server is changing the team, so this device does not upload. */
let inGame = false;
/** True while the device takes the server's team, so the commit it makes is not sent back. */
let adopting = false;
/** This visit's team has been matched with the online one. */
let linked = false;
let pushTimer = 0;
/** Something on screen needs drawing again. */
let redraw: (() => void) | null = null;
let rules: GameRules = { trackId: TRACKS[0].id, laps: TRACKS[0].defaultLaps, grid: 8, humans: 2, wearScale: 1, hazards: 0, weather: 'clear' };
let pitMode: PitMode = 'auto';

/** Revision of the online team this device last matched, for the signed-in account; 0 for none. */
function syncedRev(): number {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY) ?? 'null') as { name: string; rev: number } | null;
    return s && s.name === client.name ? s.rev : 0;
  } catch {
    return 0;
  }
}

function setSynced(rev: number): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ name: client.name, rev }));
  } catch {
    // Without storage the question is asked again next visit.
  }
}

/** Takes the team kept online, keeping this device's photos and test mode. */
function adopt(app: App, remote: Profile, rev: number): void {
  const p = app.profile;
  const { photos, admin } = p;
  Object.assign(p, upgradeProfile(remote), { photos, admin });
  adopting = true;
  app.commit();
  adopting = false;
  setSynced(rev);
}

async function pull(app: App): Promise<void> {
  const { profile, rev } = await client.loadProfile();
  if (profile) adopt(app, profile, rev);
}

/** Uploads the team over the revision this device last saw. False when the server has a newer one. */
async function push(profile: Profile): Promise<boolean> {
  try {
    setSynced((await client.saveProfile(profile, syncedRev())).rev);
    return true;
  } catch (err) {
    if ((err as Error).message.includes('changed somewhere else')) {
      setSynced(-1);
      return false;
    }
    throw err;
  }
}

/** Called whenever the team is saved on this device: keeps the online copy up to date. */
export function noteProfileChanged(profile: Profile): void {
  if (!client.signedIn || adopting || inGame || syncedRev() <= 0) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    push(profile).then(
      (ok) => {
        if (!ok) shellApp?.toast('Your online team was changed elsewhere: open the Online tab to choose', true);
      },
      () => undefined,
    );
  }, 2500);
}

/**
 * After signing in: the team on this device and the one kept online become
 * one. Uploads quietly when nothing changed online since this device last
 * synced; otherwise the player chooses.
 */
async function link(app: App): Promise<void> {
  const { profile, rev } = await client.loadProfile();
  if (!profile || rev === syncedRev()) {
    await client.saveProfile(app.profile, rev).then((r) => setSynced(r.rev));
    redraw?.();
    return;
  }
  const local = app.profile;
  const fresh = !local.cars.length && !local.drivers.length;
  if (fresh) {
    adopt(app, profile, rev);
    app.toast(`Loaded your online team: ${money(profile.money)}`);
    redraw?.();
    return;
  }
  const summary = (p: Profile): string => `${p.cars.length} cars, ${p.drivers.length} drivers, ${money(p.money)}, ${p.races} races`;
  app.dialog('Which team?', [
    h('div', { class: 'modal-text', text: 'Your online team and the team on this device are different. Which one do you want to keep? The other is replaced.' }),
    h('div', { class: 'net-choose' },
      h('button', { class: 'btn go', text: `Online team: ${summary(profile)}`, onclick: () => {
        app.closeDialog();
        adopt(app, profile, rev);
        app.toast('Loaded your online team');
        app.go('online');
      } }),
      h('button', { class: 'btn', text: `This device: ${summary(local)}`, onclick: () => {
        app.closeDialog();
        client.saveProfile(local, rev).then((r) => {
          setSynced(r.rev);
          app.toast('Uploaded the team on this device');
          app.go('online');
        }, (err: Error) => app.toast(err.message, true));
      } }),
    ),
  ]);
}

function install(app: App): void {
  if (shellApp) return;
  shellApp = app;
  client.subscribe((ev) => handle(app, ev));
}

function handle(app: App, ev: NetEvent): void {
  switch (ev.t) {
    case 'status':
      if (ev.reason) app.toast(ev.reason, ev.status !== 'online');
      if (ev.status === 'signed-out') {
        room = null;
        inGame = false;
        linked = false;
      }
      break;
    case 'hello':
      // Once per visit, and never in the middle of a race.
      if (!linked && !inGame) {
        linked = true;
        link(app).catch((err: Error) => {
          linked = false;
          app.toast(err.message, true);
        });
      }
      break;
    case 'games':
      games = ev.games;
      break;
    case 'room':
      room = ev.room;
      inGame = !!room || !!active;
      if (!room && ev.reason) app.toast(ev.reason, true);
      break;
    case 'error':
      if (!active) app.toast(ev.message, true);
      break;
    case 'race':
      room = null;
      inGame = true;
      if (!active) enterRace(app, ev);
      // The entry fee came off the team kept online.
      pull(app).catch(() => undefined);
      break;
    case 'result':
      pull(app).catch(() => undefined);
      if (!active) app.toast(ev.classified ? `Finished P${ev.position}: prize ${money(ev.prize)}` : `Race over: ${ev.record.retired}`);
      break;
  }
  redraw?.();
}

function enterRace(app: App, start: Extract<ServerMessage, { t: 'race' }>): void {
  const session = sessionFromSetup(start.setup, start.you);
  if (!session) {
    app.toast('This version of the game cannot show that race; reload the page', true);
    client.send({ t: 'leave' });
    return;
  }
  const race = session.race;
  const mirror = new RaceMirror(race);
  let result: Result | null = null;
  let footerBox: HTMLElement | null = null;
  let exitRace: (() => void) | null = null;

  const fillFooter = (): void => {
    const box = footerBox;
    if (!box) return;
    if (!result) {
      box.replaceChildren(h('div', { class: 'dim', text: 'Waiting for the stewards...' }));
      return;
    }
    const r = result;
    box.replaceChildren(
      h('div', { text: r.classified ? `You finished P${r.position}` : `Did not finish: ${r.record.retired}` }),
      h('div', { class: 'prize', text: `Prize ${money(r.prize)}` }),
      h('div', { class: 'dim', text: `Entry ${money(r.record.fee)}  Banked to your online team` }),
      h('button', { class: 'btn go', text: 'Continue', onclick: () => exitRace?.() }),
    );
  };

  const off = client.subscribe((ev) => {
    if (ev.t === 'snap') {
      mirror.apply(ev.s);
      // Nobody is watching (a hidden tab): keep the newest news only.
      if (race.events.length > EVENT_BACKLOG) race.events.splice(0, race.events.length - EVENT_BACKLOG);
    } else if (ev.t === 'result') {
      result = ev;
      fillFooter();
    } else if (ev.t === 'room' && !ev.room && ev.reason) {
      footerBox?.replaceChildren(h('div', { class: 'dim', text: ev.reason }), h('button', { class: 'btn go', text: 'Continue', onclick: () => exitRace?.() }));
    }
  });

  active = {
    session,
    advance: (dt) => mirror.advance(dt),
    command: (command) => {
      client.send({ t: 'cmd', command });
    },
    footer: (exit) => {
      exitRace = exit;
      footerBox = h('div', { class: 'reward' });
      fillFooter();
      return footerBox;
    },
    leave: () => {
      off();
      if (race.phase !== 'finished') client.send({ t: 'leave' });
      active = null;
      inGame = !!room;
    },
  };
  app.enterOnline(active);
}

// --- The screen ------------------------------------------------------------------

/** Online play: sign in, find or open a game, pick the entry, get ready. */
export function mountOnline(app: App): Screen {
  install(app);
  const { profile } = app;
  const body = h('div', { class: 'online-body scroll' });
  const head = h('span');
  const pane = h('div', { class: 'pane online' }, h('div', { class: 'title' }, 'Online', head), body);
  let busy = false;

  const choice = <T>(label: string, options: readonly { label: string; value: T }[], current: T, set: (v: T) => void): HTMLElement =>
    h('div', { class: 'choice' }, h('span', { class: 'dim', text: label }),
      ...options.map((o) => h('button', { class: `btn${o.value === current ? ' on' : ''}`, text: o.label, onclick: () => {
        set(o.value);
        render();
      } })));

  const input = (type: string, placeholder: string, max: number): HTMLInputElement => {
    const node = h('input');
    node.type = type;
    node.placeholder = placeholder;
    node.maxLength = max;
    node.autocomplete = type === 'password' ? 'current-password' : 'username';
    return node;
  };

  const signInPanel = (): void => {
    const name = input('text', 'User name', 20);
    const password = input('password', 'Password', PASSWORD_MAX);
    const go = (register: boolean): void => {
      if (busy) return;
      if (!NAME_PATTERN.test(name.value)) return app.toast('User name: 3 to 20 letters, digits, _ or -', true);
      if (password.value.length < PASSWORD_MIN) return app.toast(`Password: at least ${PASSWORD_MIN} characters`, true);
      busy = true;
      client.signIn(name.value, password.value, register).then(
        () => {
          busy = false;
          app.toast(`Signed in as ${client.name}`);
          render();
        },
        (err: Error) => {
          busy = false;
          app.toast(err.message, true);
        },
      );
    };
    password.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go(false);
    });
    body.append(
      h('div', { class: 'subhead', text: 'Race other teams' }),
      h('div', { class: 'net-note', text: 'Online races need a free account. Your team is kept on the server, so it follows you to any device. Single player works without one.' }),
      h('div', { class: 'form-row net-form' }, name, password),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Register', onclick: () => go(true) }),
        h('button', { class: 'btn go', text: 'Sign in', onclick: () => go(false) }),
      ),
    );
    window.setTimeout(() => name.focus(), 0);
  };

  const statusLine = (): HTMLElement => {
    const text = client.status === 'online' ? `Online as ${client.name}` : client.status === 'connecting' ? 'Connecting...' : `Offline (${client.name})`;
    return h('div', { class: 'net-status' },
      h('span', { class: client.status === 'online' ? 'good' : 'dim', text }),
      h('span', { class: 'spacer' }),
      client.status === 'offline' ? h('button', { class: 'btn', text: 'Connect', onclick: () => client.connect() }) : null,
      h('button', { class: 'btn', text: 'Sign out', disabled: !!room, onclick: () => {
        client.signOut().then(() => render());
      } }),
    );
  };

  const rulesText = (r: GameRules): string => {
    const track = trackById(r.trackId);
    const weather = WEATHERS.find((w) => w.id === r.weather)?.label ?? r.weather;
    const hazards = HAZARD_LEVELS.find((l) => l.max === r.hazards)?.label ?? String(r.hazards);
    return `${track ? trackTitle(track) : r.trackId}  ${r.laps} laps  ${weather}  Wear x${r.wearScale}  Hazards ${hazards}`;
  };

  const lobby = (): void => {
    body.append(h('div', { class: 'subhead', text: `Open games  ${games.length}` }));
    if (!games.length) body.append(h('div', { class: 'dim', text: 'No open games. Create one below and others can join it.' }));
    for (const g of games) {
      const open = g.humans - g.filled;
      body.append(h('div', { class: 'net-row' },
        h('div', { class: 'grow' },
          h('b', { text: `${g.host}'s game` }),
          h('div', { class: 'dim', text: rulesText(g) }),
          h('div', { text: `${g.filled}/${g.humans} teams  ${open} open seat${open === 1 ? '' : 's'}  ${g.grid - g.humans} bots  ${g.grid} cars` }),
        ),
        h('button', { class: 'btn go', text: 'Join', disabled: open <= 0 || client.status !== 'online', onclick: () => client.send({ t: 'join', game: g.id }) }),
      ));
    }

    const track = trackById(rules.trackId) ?? TRACKS[0];
    const lapOptions = [...new Set([1, ...DISTANCES.map((d) => Math.min(LAPS_MAX, track.defaultLaps * d.laps))])];
    if (!lapOptions.includes(rules.laps)) rules.laps = lapOptions[1] ?? 1;
    const grids = Array.from({ length: GRID_MAX - GRID_MIN + 1 }, (_, i) => GRID_MIN + i);
    rules.humans = Math.min(rules.humans, rules.grid);
    body.append(
      h('div', { class: 'subhead', text: 'Create a game' }),
      choice('Circuit', TRACKS.map((t) => ({ label: trackTitle(t), value: t.id })), rules.trackId, (v) => (rules = { ...rules, trackId: v })),
      choice('Laps', lapOptions.map((n) => ({ label: String(n), value: n })), rules.laps, (v) => (rules.laps = v)),
      choice('Cars on grid', grids.map((n) => ({ label: String(n), value: n })), rules.grid, (v) => (rules.grid = v)),
      choice('Human teams', grids.filter((n) => n <= rules.grid).map((n) => ({ label: String(n), value: n })), rules.humans, (v) => (rules.humans = v)),
      choice('Tyre and fuel use', WEAR_SCALES.map((w) => ({ label: w.label, value: w.scale })), rules.wearScale, (v) => (rules.wearScale = v)),
      choice('Road hazards', HAZARD_LEVELS.map((l) => ({ label: l.label, value: l.max })), rules.hazards, (v) => (rules.hazards = v)),
      choice('Weather', WEATHERS.map((w) => ({ label: w.label, value: w.id })), rules.weather, (v) => (rules.weather = v)),
      h('div', { class: 'prizes' },
        h('span', { class: 'gold', text: `Entry fee ${money(entryFee(track))}` }),
        ...[1, 2, 3].map((p) => h('span', { text: `P${p} ${money(prizeMoney(track, p))}` })),
        h('span', { text: `${rules.humans} human ${rules.humans === 1 ? 'team' : 'teams'}, ${rules.grid - rules.humans} bots` }),
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Refresh list', onclick: () => client.send({ t: 'list' }) }),
        h('button', { class: 'btn go big', text: 'Create game', disabled: client.status !== 'online', onclick: () => client.send({ t: 'create', ...rules }) }),
      ),
    );
  };

  const enter = (carId: string | null, driverId: string | null): void => {
    profile.selectedCar = carId ?? profile.selectedCar;
    profile.selectedDriver = driverId ?? profile.selectedDriver;
    app.commit();
    const car = profile.cars.find((c) => c.id === profile.selectedCar);
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    if (!car || !driver || busy) return render();
    busy = true;
    // The server takes the fee from, and banks the prize to, the team it keeps: send it the latest first.
    push(profile).then(
      (ok) => {
        busy = false;
        if (!ok) {
          app.toast('Your online team was changed elsewhere: choose which to keep', true);
          link(app).catch(() => undefined);
          return;
        }
        client.send({ t: 'entry', car, driver: driver.def, pitMode });
      },
      (err: Error) => {
        busy = false;
        app.toast(err.message, true);
      },
    );
    render();
  };

  const roomView = (r: RoomInfo): void => {
    const track = trackById(r.trackId) ?? TRACKS[0];
    const me = r.seats.find((s) => s?.name === client.name) ?? null;
    const isHost = r.host === client.name;
    const joined = r.seats.filter(Boolean);
    const open = r.seats.length - joined.length;
    body.append(
      h('div', { class: 'subhead', text: `${r.host}'s game` }),
      h('div', { class: 'dim', text: rulesText(r) }),
      h('div', { class: 'dim', text: `${r.grid} cars: ${r.humans} human ${r.humans === 1 ? 'seat' : 'seats'}, ${r.grid - r.humans} bots. Entry ${money(entryFee(track))}.` }),
    );
    const seats = h('div', { class: 'net-seats' });
    r.seats.forEach((s, i) => {
      seats.append(s
        ? h('div', { class: `net-seat${s.ready ? ' ready' : ''}${s.name === client.name ? ' me' : ''}` },
          h('b', { text: `${i + 1}  ${s.name}${s.name === r.host ? ' (host)' : ''}` }),
          h('span', { class: 'dim', text: s.car ? `${s.car}  ${s.driver}` : 'Choosing a car' }),
          h('span', { class: s.ready ? 'good' : 'dim', text: !s.connected ? 'Away' : s.ready ? 'Ready' : 'Not ready' }))
        : h('div', { class: 'net-seat open' }, h('b', { text: `${i + 1}  Open seat` }), h('span', { class: 'dim', text: 'Waiting for a team; a bot takes it if the host starts now' })));
    });
    if (r.grid > r.humans) seats.append(h('div', { class: 'net-seat bot' }, h('b', { text: `+ ${r.grid - r.humans} bots` }), h('span', { class: 'dim', text: 'Built from the parts catalog' })));
    body.append(seats);

    body.append(h('div', { class: 'subhead', text: 'Your entry' }));
    const legal = profile.cars.filter((c) => raceLegal(c, track));
    if (!legal.length) {
      body.append(h('div', { class: 'pick-row' }, h('div', { class: 'pick', onclick: () => app.go('garage') }, h('div', {}, h('b', { text: 'No race-legal car' }), 'Build one in the garage'))));
    } else {
      body.append(h('div', { class: 'pick-row wrap' }, ...legal.map((c) => h('div', {
        class: `pick${c.id === profile.selectedCar ? ' on' : ''}`, onclick: () => enter(c.id, null),
      }, h('div', { class: 'stripe', style: { background: `#${c.livery.base.toString(16).padStart(6, '0')}` } }), h('div', {}, h('b', { text: chassisName(c) }))))));
    }
    if (!profile.drivers.length) {
      body.append(h('div', { class: 'pick-row' }, h('div', { class: 'pick', onclick: () => app.go('drivers') }, h('div', {}, h('b', { text: 'No driver' }), 'Sign one first'))));
    } else {
      body.append(h('div', { class: 'pick-row wrap' }, ...profile.drivers.map((d) => h('div', {
        class: `pick${d.def.id === profile.selectedDriver ? ' on' : ''}`, onclick: () => enter(null, d.def.id),
      }, h('div', {}, h('b', { text: d.def.name }), h('div', { class: 'dim', text: `${d.def.racesCompleted} races` }))))));
    }
    body.append(choice('Pit stops', [{ label: 'Driver decides', value: 'auto' as const }, { label: 'Pit wall calls (you)', value: 'manual' as const }], pitMode, (v) => {
      pitMode = v;
      if (me?.car) enter(null, null);
    }));

    const allReady = joined.every((s) => s?.ready);
    body.append(
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Leave', onclick: () => client.send({ t: 'leave' }) }),
        me?.car && !me.ready ? null : h('button', { class: 'btn', text: me?.car ? 'Enter again' : 'Enter car and driver', disabled: busy, onclick: () => enter(null, null) }),
        h('button', { class: `btn ${me?.ready ? 'warn' : 'go'} big`, text: me?.ready ? 'Not ready' : 'Ready', disabled: !me?.car, onclick: () => client.send({ t: 'ready', ready: !me?.ready }) }),
        isHost ? h('button', { class: 'btn go', text: open ? `Start now (${open} to bots)` : 'Start now', disabled: !allReady, onclick: () => client.send({ t: 'start' }) }) : null,
      ),
      h('div', { class: 'dim', style: { textAlign: 'center' }, text: open
        ? 'The race starts when every seat is taken and everyone is ready, or when the host starts it.'
        : 'The race starts as soon as everyone is ready.' }),
    );
  };

  const render = (): void => {
    body.replaceChildren();
    head.textContent = client.signedIn ? client.name : '';
    if (!client.signedIn) {
      signInPanel();
      return;
    }
    body.append(statusLine());
    if (room) roomView(room);
    else lobby();
  };

  redraw = render;
  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  app.garage.setCar(profile.cars.find((c) => c.id === profile.selectedCar) ?? profile.cars[0] ?? null);
  app.garage.setViewShift(0.26, -0.04);
  app.garage.resetView();
  if (client.signedIn) {
    client.connect();
    client.send({ t: 'list' });
  }
  render();
  return {
    root: pane,
    dispose: () => {
      if (redraw === render) redraw = null;
    },
  };
}
