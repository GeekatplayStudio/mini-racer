import type * as THREE from 'three';
import { TRACKS } from '../data/tracks';
import { RaceSession, createQuickRace } from '../game/raceSetup';
import { NAME_PATTERN, PASSWORD_MAX, PASSWORD_MIN } from '../net/protocol';
import { netClient } from '../net/client';
import { CameraMode, RaceView } from '../render/raceView';
import { RaceCar, SIM_DT, Weather } from '../sim/race';
import { h } from './dom';
import { trackTitle } from './hud';
import './title.css';

const DEMO_GRID = 12;
const WEATHER_ROTA: readonly Weather[] = ['clear', 'rain', 'clear', 'snow', 'clear'];
const WEATHER_LABEL: Record<Weather, string> = { clear: 'Dry', rain: 'Showers', snow: 'Light snow' };
/** Seconds the finish stays on screen before the next race. */
const AFTER_FLAG = 5;

interface Shot {
  mode: CameraMode;
  car: number;
  seconds: number;
  label: string;
}

/**
 * The screen a visitor sees first: a real race between computer drivers,
 * filmed by a camera that cuts between battles, the leader, the driver's eye
 * and the whole circuit, with the title and the sign-in panel over it.
 */
export class TitleScreen {
  readonly root: HTMLElement;
  /** The race being shown; read by tests. */
  session!: RaceSession;
  private view!: RaceView;
  private raceNo = 0;
  private accumulator = 0;
  private shot: Shot | null = null;
  private shotLeft = 0;
  private afterFlag = 0;
  private captionTimer = 0;
  private readonly caption: HTMLElement;
  private readonly panel: HTMLElement;
  private size = { w: 1280, h: 720 };
  private busy = false;

  /**
   * @param done called when the visitor signs in, registers or chooses to play offline.
   */
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly done: () => void) {
    this.raceNo = Math.floor(Math.random() * TRACKS.length);
    this.caption = h('div', { class: 'title-caption' });
    this.panel = h('div', { class: 'title-panel' });
    this.root = h('div', { class: 'title-screen' },
      h('div', { class: 'title-head' },
        h('h1', { class: 'title-logo', text: 'MiniRacer' }),
        h('div', { class: 'title-tag', text: 'Build the car. Make the driver. Run the race.' }),
      ),
      this.panel,
      h('div', { class: 'title-foot' },
        this.caption,
        h('div', { class: 'title-by', text: 'Geekatplay Studio  ·  Vladimir Chopine' }),
      ),
    );
    this.drawPanel(netClient().signedIn ? 'welcome' : 'signin');
    this.newRace(true);
  }

  resize(w: number, hgt: number): void {
    this.size = { w, h: hgt };
    this.view.resize(w, hgt);
  }

  frame(dt: number): void {
    const race = this.session.race;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 240) {
      race.step();
      this.accumulator -= SIM_DT;
      steps++;
    }
    if (steps === 240) this.accumulator = 0;
    race.events.length = 0;

    if (race.phase === 'finished') {
      this.afterFlag += dt;
      if (this.afterFlag > AFTER_FLAG) {
        this.newRace(false);
        return;
      }
    }
    this.shotLeft -= dt;
    if (this.shotLeft <= 0 || !this.shot || !this.watchable(race.cars[this.shot.car])) this.nextShot();

    this.view.update(dt);
    this.view.render();

    this.captionTimer -= dt;
    if (this.captionTimer <= 0) {
      this.captionTimer = 0.5;
      this.drawCaption();
    }
  }

  dispose(): void {
    this.view.dispose();
    this.root.remove();
  }

  /** Starts the next race on the next circuit; the very first one joins a race already under way. */
  private newRace(first: boolean): void {
    this.view?.dispose();
    const def = TRACKS[this.raceNo % TRACKS.length];
    const weather = WEATHER_ROTA[this.raceNo % WEATHER_ROTA.length];
    this.raceNo++;
    this.session = createQuickRace({
      trackDef: def,
      gridSize: DEMO_GRID,
      laps: def.lengthM < 3000 ? 3 : 2,
      seed: Math.floor(Math.random() * 0x7fffffff),
      playerGrid: 0,
      weather,
      hazards: Math.random() < 0.35 ? 2 : 0,
    });
    this.view = new RaceView(this.renderer, this.session);
    this.view.resize(this.size.w, this.size.h);
    if (first) {
      // Join after the start, with the field already strung out a little.
      const race = this.session.race;
      while (race.phase === 'countdown') race.step();
      for (let i = 0; i < 6 / SIM_DT; i++) race.step();
      race.events.length = 0;
    }
    this.accumulator = 0;
    this.afterFlag = 0;
    this.shot = null;
    this.shotLeft = 0;
  }

  private watchable(car: RaceCar | undefined): boolean {
    return !!car && !car.parked && !car.retired;
  }

  /** The two cars closest together on the road, behind first. */
  private closestFight(): RaceCar | null {
    const order = this.session.race.order;
    let best: RaceCar | null = null;
    let gap = Infinity;
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i];
      if (!this.watchable(a) || !this.watchable(b) || b.finished) continue;
      const d = a.progress - b.progress;
      if (d > 0 && d < gap) {
        gap = d;
        best = b;
      }
    }
    return gap < 40 ? best : null;
  }

  private nextShot(): void {
    const race = this.session.race;
    const live = race.cars.filter((c) => this.watchable(c));
    if (!live.length) return;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    const leader = race.order.find((c) => this.watchable(c)) ?? live[0];
    const fight = this.closestFight();
    const last = this.shot;
    let shot: Shot;
    const roll = Math.random();
    if (race.phase === 'finished') {
      shot = { mode: 'chase', car: leader.id, seconds: AFTER_FLAG, label: 'The winner' };
    } else if (last?.mode !== 'overview' && roll < 0.14) {
      shot = { mode: 'overview', car: leader.id, seconds: 4.5, label: 'The whole circuit' };
    } else if (fight && roll < 0.62) {
      const mode: CameraMode = last?.mode === 'chase' && Math.random() < 0.45 ? 'pov' : 'chase';
      shot = { mode, car: fight.id, seconds: mode === 'pov' ? 6 : 8, label: mode === 'pov' ? 'On board' : 'Battle' };
    } else if (roll < 0.78) {
      shot = { mode: 'chase', car: leader.id, seconds: 7, label: 'The leader' };
    } else {
      const car = pick(live);
      const mode: CameraMode = Math.random() < 0.4 ? 'pov' : 'chase';
      shot = { mode, car: car.id, seconds: mode === 'pov' ? 6 : 7, label: mode === 'pov' ? 'On board' : 'In the pack' };
    }
    // Never the same picture twice in a row.
    if (last && last.mode === shot.mode && last.car === shot.car && shot.mode !== 'overview') {
      shot = { mode: 'overview', car: leader.id, seconds: 4.5, label: 'The whole circuit' };
    }
    this.shot = shot;
    this.shotLeft = shot.seconds;
    this.view.cut(shot.mode, shot.car);
    this.drawCaption();
  }

  private drawCaption(): void {
    const { race, trackDef } = this.session;
    const shot = this.shot;
    const car = shot ? race.cars[shot.car] : null;
    const lap = Math.min(race.laps, Math.max(1, race.order[0].crossings));
    const parts = [
      trackTitle(trackDef),
      WEATHER_LABEL[race.weather],
      race.phase === 'finished' ? 'Chequered flag' : `Lap ${lap} of ${race.laps}`,
    ];
    if (car && shot && shot.mode !== 'overview') {
      // Positions change during a shot: say what is true now.
      const label = shot.mode === 'pov' ? 'On board' : car.position === 1 ? 'Leader' : shot.label === 'Battle' ? 'Battle' : 'Following';
      parts.push(`${label}: P${car.position} ${car.driver.name}`);
    }
    this.caption.replaceChildren(h('b', { text: 'Live' }), document.createTextNode(parts.join('   ·   ')));
  }

  private drawPanel(mode: 'signin' | 'register' | 'welcome', message = '', bad = false): void {
    const client = netClient();
    const note = h('div', { class: `title-msg${bad ? ' bad' : ''}`, text: message });
    const offline = h('button', { class: 'btn title-offline', text: 'Play offline', onclick: () => this.done() });

    if (mode === 'welcome') {
      this.panel.replaceChildren(
        h('div', { class: 'title-panel-head', text: `Welcome back, ${client.name}` }),
        h('div', { class: 'title-note', text: 'Your team is saved online and follows you to any device.' }),
        note,
        h('button', { class: 'btn go big', text: 'Continue', onclick: () => this.done() }),
        h('button', { class: 'btn title-link', text: 'Sign out', onclick: () => {
          client.signOut().finally(() => this.drawPanel('signin', 'Signed out'));
        } }),
      );
      return;
    }

    const register = mode === 'register';
    const field = (label: string, type: string, max: number, auto: AutoFill): HTMLInputElement => {
      const input = h('input');
      input.type = type;
      input.maxLength = max;
      input.autocomplete = auto;
      input.setAttribute('aria-label', label);
      input.placeholder = label;
      return input;
    };
    const name = field('User name', 'text', 20, 'username');
    const password = field('Password', 'password', PASSWORD_MAX, register ? 'new-password' : 'current-password');
    const again = register ? field('Password again', 'password', PASSWORD_MAX, 'new-password') : null;
    const submit = h('button', { class: 'btn go big', text: register ? 'Create account' : 'Sign in' });

    const go = (): void => {
      if (this.busy) return;
      const fail = (text: string): void => {
        note.textContent = text;
        note.className = 'title-msg bad';
      };
      if (!NAME_PATTERN.test(name.value)) return fail('User name: 3 to 20 letters, digits, _ or -');
      if (password.value.length < PASSWORD_MIN) return fail(`Password: at least ${PASSWORD_MIN} characters`);
      if (again && again.value !== password.value) return fail('The two passwords are not the same');
      this.busy = true;
      submit.disabled = true;
      note.textContent = register ? 'Creating your account...' : 'Signing in...';
      note.className = 'title-msg';
      client.signIn(name.value, password.value, register).then(
        () => {
          this.busy = false;
          this.done();
        },
        (err: Error) => {
          this.busy = false;
          submit.disabled = false;
          fail(err.message === 'Cannot reach the game server' ? 'The game server cannot be reached right now. You can still play offline.' : err.message);
        },
      );
    };
    submit.addEventListener('click', go);
    for (const input of [name, password, again]) {
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    }

    const tab = (label: string, which: 'signin' | 'register'): HTMLElement => {
      const node = h('button', { class: `title-tab${mode === which ? ' on' : ''}`, text: label, onclick: () => {
        if (mode !== which) this.drawPanel(which);
      } });
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(mode === which));
      return node;
    };
    const tabs = h('div', { class: 'title-tabs' }, tab('Sign in', 'signin'), tab('Register', 'register'));
    tabs.setAttribute('role', 'tablist');

    this.panel.replaceChildren(
      tabs,
      h('form', { class: 'title-form' }, name, password, again),
      note,
      submit,
      h('div', { class: 'title-or', text: 'or' }),
      offline,
      h('div', { class: 'title-note', text: register
        ? 'A free account lets you race other teams online and keeps your team on any device.'
        : 'Single player needs no account.' }),
    );
    if (message) note.textContent = message;
    // Enter in a field must not reload the page.
    this.panel.querySelector('form')?.addEventListener('submit', (e) => e.preventDefault());
    window.setTimeout(() => name.focus(), 0);
  }
}
