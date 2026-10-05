import { SHOW_REFERENCE_NAMES, alias } from '../data/naming';
import { DriverLook, WEATHERS } from '../game/profile';
import type { RaceSession } from '../game/raceSetup';
import { Command, PitPhase, RaceCar, RaceEvent } from '../sim/race';
import type { TrackDef } from '../sim/track';
import { IconName, icon } from './icons';
import { drawFace, faceMouthRow, lookFor } from './portrait';
import { COMMANDS, banter } from './radio';

/** Circuit name as shown to the player. */
export function trackTitle(def: TrackDef): string {
  return SHOW_REFERENCE_NAMES ? def.name : def.publicName;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface TowerRow {
  row: HTMLElement;
  pos: HTMLElement;
  chip: HTMLElement;
  code: HTMLElement;
  gap: HTMLElement;
}

const RPM_SEGMENTS = 24;
const RADIO_MAX = 4;
const RADIO_SECONDS = 7;

/** Who a radio message comes from: a driver, by car id, or one of the voices without a face. */
type Voice = { car: number } | 'wall' | 'marshal' | 'control';

const VOICES: Record<'wall' | 'marshal' | 'control', { label: string; icon: IconName }> = {
  wall: { label: 'Pit wall', icon: 'headset' },
  marshal: { label: 'Marshals', icon: 'marshal' },
  control: { label: 'Race control', icon: 'flag' },
};

const WEATHER_ICONS: Record<string, IconName> = { clear: 'sun', rain: 'rain', snow: 'snow' };
const GROUP_LABELS = { pace: 'Pace', stance: 'Racecraft', pit: 'Pit' } as const;

/** Dark or light ink, whichever reads better on the colour. */
function inkOn(color: number): string {
  const lum = 0.299 * (color >> 16) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255);
  return lum > 140 ? '#0d0f1e' : '#f4f4f0';
}

/** Race overlay: timing tower, session info, dashboard, minimap and messages. */
export class Hud {
  private readonly towerLap: HTMLElement;
  private readonly rows: TowerRow[] = [];
  private readonly clock: HTMLElement;
  private readonly best: HTMLElement;
  private readonly fastest: HTMLElement;
  private readonly status: HTMLElement;
  private readonly driver: HTMLElement;
  private readonly carName: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly rpm: HTMLElement[] = [];
  private readonly bars: Record<'thr' | 'brk' | 'tyre' | 'fuel', HTMLElement>;
  private readonly barText: Record<'tyre' | 'fuel', HTMLElement>;
  private readonly looks = new Map<number, DriverLook>();
  private readonly lights: HTMLElement;
  private readonly lamps: HTMLElement[] = [];
  private readonly banner: HTMLElement;
  private readonly results: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly mapBase: HTMLCanvasElement;
  private readonly mapXform: { scale: number; ox: number; oy: number };
  private bannerTimer = 0;
  private radioBox!: HTMLElement;
  private radioItems: { node: HTMLElement; left: number }[] = [];
  private readonly cmdButtons = new Map<Command, HTMLElement>();
  private pitLine!: HTMLElement;
  private pitState!: HTMLElement;
  private pitDamage!: HTMLElement;
  private lastBanter = -10;
  private slowTimer = 0;
  private resultsShown = false;

  /**
   * @param hints key and label pairs shown at the bottom of the screen.
   * @param resultFooter builds what sits under the result table, e.g. the prize and a continue button.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly session: RaceSession,
    hints: readonly (readonly [string, string])[] = [['Tab', 'Car'], ['C', 'Camera'], ['1 2 3', 'Speed'], ['P', 'Pause'], ['R', 'New race']],
    private readonly resultFooter?: () => HTMLElement,
    private readonly onCommand?: (command: Command) => void,
  ) {
    root.replaceChildren();
    const { race, track } = session;

    // Timing tower.
    const tower = el('div', 'panel tower');
    const head = el('div', 'tower-head');
    head.append(el('span', '', 'Lap'));
    this.towerLap = el('span');
    head.append(this.towerLap);
    tower.append(head);
    for (let i = 0; i < race.cars.length; i++) {
      const row = el('div', 'tower-row');
      const r: TowerRow = { row, pos: el('span', 'pos'), chip: el('span', 'chip'), code: el('span', 'code'), gap: el('span', 'gap') };
      row.append(r.pos, r.chip, r.code, r.gap);
      tower.append(row);
      this.rows.push(r);
    }
    root.append(tower);

    // Session panel.
    const sessionPanel = el('div', 'panel session');
    sessionPanel.append(el('div', 'track', trackTitle(track.def)));
    const weather = WEATHERS.find((w) => w.id === race.weather);
    if (weather) {
      const tag = el('div', `weather ${weather.id}`);
      tag.append(icon(WEATHER_ICONS[weather.id] ?? 'sun'), document.createTextNode(weather.label));
      sessionPanel.append(tag);
    }
    this.clock = el('div', 'clock', '0:00.000');
    this.best = el('div', 'small');
    this.fastest = el('div', 'small fastest');
    this.status = el('div', 'small');
    sessionPanel.append(this.clock, this.best, this.fastest, this.status);
    root.append(sessionPanel);

    // Dashboard.
    const dash = el('div', 'panel dash');
    const driverLine = el('div', 'driver');
    this.driver = el('b');
    this.carName = el('span');
    driverLine.append(this.driver, this.carName);
    const main = el('div', 'main');
    this.gear = el('div', 'gear', 'N');
    const speedBox = el('div');
    this.speed = el('div', 'speed', '0');
    speedBox.append(this.speed, el('div', 'unit', 'km/h'));
    main.append(this.gear, speedBox);
    const rpm = el('div', 'rpm');
    for (let i = 0; i < RPM_SEGMENTS; i++) {
      const seg = el('i', i >= RPM_SEGMENTS - 4 ? 'high' : i >= RPM_SEGMENTS - 9 ? 'mid' : '');
      rpm.append(seg);
      this.rpm.push(seg);
    }
    const bars = el('div', 'bars');
    const values: HTMLElement[] = [];
    const makeBar = (label: string, cls: string): HTMLElement => {
      const bar = el('div', `bar ${cls}`);
      const fill = el('i');
      bar.append(fill);
      const value = el('b');
      values.push(value);
      bars.append(el('span', '', label), bar, value);
      return fill;
    };
    this.bars = {
      thr: makeBar('Thr', 'thr'),
      brk: makeBar('Brk', 'brk'),
      tyre: makeBar('Tyre', 'tyre'),
      fuel: makeBar('Fuel', 'fuel'),
    };
    this.barText = { tyre: values[2], fuel: values[3] };
    dash.append(driverLine, main, rpm, bars);
    root.append(dash);

    // Minimap.
    const mapPanel = el('div', 'panel map');
    this.map = el('canvas');
    this.map.width = 192;
    this.map.height = 128;
    mapPanel.append(this.map);
    root.append(mapPanel);
    const ctx = this.map.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.mapCtx = ctx;
    [this.mapBase, this.mapXform] = this.drawMapBase();

    // Start lights and messages.
    this.lights = el('div', 'panel lights');
    for (let i = 0; i < 5; i++) {
      const lamp = el('i');
      this.lights.append(lamp);
      this.lamps.push(lamp);
    }
    root.append(this.lights);
    this.banner = el('div', 'banner hidden');
    root.append(this.banner);

    const hintBar = el('div', 'hints');
    for (const [key, label] of hints) hintBar.append(el('b', '', key), document.createTextNode(` ${label}   `));
    root.append(hintBar);

    // Radio traffic, newest at the bottom.
    this.radioBox = el('div', 'radio');
    root.append(this.radioBox);

    // Pit-wall orders for the player's driver.
    if (this.onCommand) {
      const bar = el('div', 'cmdbar');
      let group = '';
      let box = bar;
      for (const c of COMMANDS) {
        if (c.group !== group) {
          group = c.group;
          box = el('div', 'cmd-group');
          box.append(el('span', 'cap', GROUP_LABELS[c.group]));
          bar.append(box);
        }
        const btn = el('button', 'cmd');
        btn.title = c.call;
        btn.append(el('b', '', c.key), document.createTextNode(` ${c.label}`));
        btn.addEventListener('click', () => this.order(c.id));
        box.append(btn);
        this.cmdButtons.set(c.id, btn);
      }
      root.append(bar);
    }
    this.pitLine = el('div', 'pitline');
    this.pitState = el('span', 'state');
    this.pitDamage = el('span', 'hurt');
    this.pitLine.append(this.pitState, this.pitDamage);
    dash.append(this.pitLine);

    this.results = el('div', 'panel results hidden');
    root.append(this.results);
  }

  private drawMapBase(): [HTMLCanvasElement, { scale: number; ox: number; oy: number }] {
    const { track } = this.session;
    const base = document.createElement('canvas');
    base.width = this.map.width;
    base.height = this.map.height;
    const ctx = base.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.x[i]);
      maxX = Math.max(maxX, track.x[i]);
      minY = Math.min(minY, track.y[i]);
      maxY = Math.max(maxY, track.y[i]);
    }
    const pad = 10;
    const scale = Math.min((base.width - pad * 2) / (maxX - minX), (base.height - pad * 2) / (maxY - minY));
    const ox = (base.width - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (base.height - (maxY - minY) * scale) / 2 - minY * scale;
    const path = (): void => {
      ctx.beginPath();
      for (let i = 0; i < track.n; i += 2) {
        const x = track.x[i] * scale + ox, y = track.y[i] * scale + oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f4f4f0';
    ctx.lineWidth = 7;
    path();
    ctx.stroke();
    ctx.strokeStyle = '#3a3f66';
    ctx.lineWidth = 4;
    path();
    ctx.stroke();
    // Start line.
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(Math.round(track.x[0] * scale + ox) - 1, Math.round(track.y[0] * scale + oy) - 5, 2, 10);
    return [base, { scale, ox, oy }];
  }

  /** Shows a short message in the middle of the screen. */
  flash(text: string, style: '' | 'small' | 'purple' | 'green' | 'small purple' = '', seconds = 2.2): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${style}`;
    this.bannerTimer = seconds;
  }

  /** Sends an order to the player's driver and shows the call on the radio. */
  order(command: Command): void {
    const c = COMMANDS.find((x) => x.id === command);
    if (!c || !this.onCommand) return;
    this.say(`${c.call}.`, 'call', 'wall');
    this.onCommand(command);
  }

  private lookOf(car: number): DriverLook {
    let look = this.looks.get(car);
    if (!look) {
      const entry = this.session.entries[car];
      look = entry.look ?? lookFor(`${entry.driver.name}/${entry.driver.id}`);
      this.looks.set(car, look);
    }
    return look;
  }

  /** Adds a message to the radio feed: a driver's face or a voice icon, a name tag and the words. */
  private say(text: string, style = '', from: Voice = 'control'): void {
    const node = el('div', `msg ${style}`);
    const who = el('div', 'who');
    const tag = el('span', 'tag');
    if (typeof from === 'object') {
      const entry = this.session.entries[from.car];
      const look = this.lookOf(from.car);
      const face = el('canvas', 'face');
      drawFace(face, look);
      const mouth = el('i', 'mouth');
      mouth.style.top = `${(faceMouthRow(look) / 32) * 100}%`;
      who.append(face, mouth);
      node.classList.add('driver');
      tag.textContent = entry.driver.code;
      tag.style.background = hex(entry.livery.base);
      tag.style.color = inkOn(entry.livery.base);
      who.style.borderColor = hex(entry.livery.base);
    } else {
      who.append(icon(VOICES[from].icon));
      node.classList.add('voice', from);
      tag.textContent = VOICES[from].label;
    }
    const bubble = el('div', 'bubble');
    bubble.append(tag, el('span', 'text', text));
    node.append(who, bubble);
    this.radioBox.append(node);
    this.radioItems.push({ node, left: RADIO_SECONDS });
    while (this.radioItems.length > RADIO_MAX) this.radioItems.shift()?.node.remove();
  }

  handleEvents(events: readonly RaceEvent[], focusCar: number): void {
    const { race } = this.session;
    const player = this.session.playerCar;
    const code = (id: number): string => race.cars[id].driver.code;
    for (const ev of events) {
      if (ev.type === 'radio' && ev.car === player) {
        const c = COMMANDS.find((x) => x.id === ev.command);
        if (c) this.say(ev.obeyed ? c.yes : c.no, ev.obeyed ? 'reply' : 'refuse', { car: ev.car });
      } else if (ev.type === 'pit') {
        if (ev.stage === 'called' && ev.car === player) this.say('Tyres or fuel are low. Boxing this lap.', 'reply', { car: ev.car });
        else if (ev.stage === 'in') this.say(`${code(ev.car)} is in the pits: ${ev.seconds.toFixed(1)} s stop.`, ev.car === player ? 'call' : '');
        else if (ev.stage === 'out' && ev.car === player) this.say('Fresh tyres, full of fuel. Go!', 'reply', { car: ev.car });
      } else if (ev.type === 'hazard') {
        const what = { oil: 'Oil', wreck: 'A crashed car', animal: 'An animal', tyre: 'A loose tyre', debris: 'Debris' }[ev.kind];
        if (ev.stage === 'appeared') this.say(`Yellow flag. ${what} on the track.`, 'call', 'marshal');
        else if (ev.stage === 'hit' && ev.car >= 0) this.say(`${code(ev.car)} hit ${what.toLowerCase()}!`, ev.car === player ? 'refuse' : '');
      } else if (ev.type === 'damage') {
        if (ev.car === player || ev.car === focusCar) {
          const where = { front: 'the nose', rear: 'the tail', left: 'the left side', right: 'the right side' }[ev.zone];
          this.say(`${ev.level === 2 ? 'Heavy damage to' : 'Damage to'} ${where}. Still running, but slower.`, 'refuse', { car: ev.car });
        }
      } else if (ev.type === 'retire') {
        this.say(`${code(ev.car)} is out: ${ev.reason === 'fuel' ? 'out of fuel' : 'tyre failure'}.`, 'refuse');
        if (ev.car === player) this.flash(ev.reason === 'fuel' ? 'Out of fuel' : 'Tyre failure', 'small', 4);
      } else if (race.time - this.lastBanter > 7) {
        // Drivers have opinions about each other.
        const involved = ev.type === 'overtake' ? [ev.car, ev.passed] : ev.type === 'contact' ? [ev.a, ev.b] : ev.type === 'wall' ? [ev.car] : [];
        if (involved.length && (involved.includes(focusCar) || involved.includes(player) || race.steps % 3 === 0)) {
          const line = banter(ev, code, race.steps + involved[0] * 7);
          if (line) {
            this.say(line.text, '', { car: line.car });
            this.lastBanter = race.time;
          }
        }
      }
    }
    for (const ev of events) {
      if (ev.type === 'green') this.flash('Go!', 'green', 1.6);
      else if (ev.type === 'lap' && ev.fastest && ev.lap > 1) {
        this.flash(`Fastest lap ${race.cars[ev.car].driver.code} ${formatTime(ev.time)}`, 'small purple', 3);
      } else if (ev.type === 'finish' && ev.position === 1) {
        this.flash(`${race.cars[ev.car].driver.code} wins!`, '', 4);
      } else if (ev.type === 'finish' && ev.car === focusCar) {
        this.flash(`Finished P${ev.position}`, 'small', 4);
      }
    }
  }

  update(dt: number, focusCar: number, timeScale: number, paused: boolean): void {
    const { race, entries } = this.session;
    const car = race.cars[focusCar];
    const st = car.state;

    for (const item of this.radioItems) {
      item.left -= dt;
      if (item.left <= 0) item.node.remove();
      else if (item.left < 1.5) item.node.style.opacity = String(item.left / 1.5);
    }
    this.radioItems = this.radioItems.filter((i) => i.left > 0);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }

    // Fast-changing readouts every frame.
    const speed = Math.hypot(st.vx, st.vy);
    this.speed.textContent = String(Math.round(speed * 3.6));
    this.gear.textContent = speed < 0.5 && st.throttle < 0.05 ? 'N' : String(st.gear + 1);
    const frac = (st.rpm - car.spec.engine.idle * 0.5) / (car.spec.engine.redline - car.spec.engine.idle * 0.5);
    const lit = Math.round(frac * RPM_SEGMENTS);
    this.rpm.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    this.bars.thr.style.width = `${Math.round(st.throttle * 100)}%`;
    this.bars.brk.style.width = `${Math.round(st.brake * 100)}%`;
    this.clock.textContent = formatTime(race.time);
    this.lights.classList.toggle('hidden', race.phase !== 'countdown');
    this.lamps.forEach((lamp, i) => lamp.classList.toggle('on', i < race.lights));
    this.drawMap(focusCar);

    // Slower readouts a few times a second.
    this.slowTimer -= dt;
    if (this.slowTimer > 0) return;
    this.slowTimer = 0.15;

    const lap = Math.min(race.laps, Math.max(1, race.order[0].crossings));
    this.towerLap.textContent = race.phase === 'finished' ? 'Finish' : `${lap}/${race.laps}`;
    const leader = race.order[0];
    race.order.forEach((c, i) => {
      const r = this.rows[i];
      const entry = entries[c.id];
      r.row.className = `tower-row${c.id === focusCar ? ' focus' : ''}${entry.isPlayer ? ' player' : ''}`;
      r.pos.textContent = String(i + 1);
      r.chip.style.background = hex(entry.livery.base);
      r.code.textContent = c.driver.code;
      r.gap.className = `gap${c.finished ? ' done' : ''}`;
      r.gap.textContent = this.gapText(c, leader, i);
    });

    this.driver.textContent = `P${car.position} ${car.driver.name}`;
    this.carName.textContent = entries[focusCar].isPlayer ? 'Your car' : '';
    this.best.textContent = `Last ${formatTime(car.lastLap || Infinity)}  Best ${formatTime(car.bestLap)}`;
    this.fastest.textContent =
      race.fastestLapCar >= 0 ? `Fastest ${race.cars[race.fastestLapCar].driver.code} ${formatTime(race.fastestLap)}` : '';
    this.status.textContent = paused ? 'Paused' : timeScale !== 1 ? `Speed ${timeScale}x` : '';
    const pit =
      car.retired ? `Retired: ${car.retireReason === 'fuel' ? 'out of fuel' : 'tyre failure'}`
      : car.pitPhase === PitPhase.Stopped ? `In the box ${Math.max(0, car.pitTimer).toFixed(0)} s`
      : car.pitPhase !== PitPhase.None ? 'Pit lane'
      : car.pitRequested ? 'Box this lap' : car.pitMode === 'auto' ? 'Pit: auto' : 'Pit: your call';
    this.pitState.textContent = pit;
    this.pitDamage.textContent = st.damage >= 0.02 ? `Damage ${Math.round(st.damage * 100)}%` : '';
    this.barText.tyre.textContent = `${Math.round((1 - st.tyreWear) * 100)}%`;
    this.barText.fuel.textContent = `${race.fuelLapsLeft(car).toFixed(1)} laps`;
    this.pitLine.classList.toggle('warn', race.fuelLapsLeft(car) < 2 || st.tyreWear > 0.8 || st.damage > 0.5);
    const me = race.cars[this.session.playerCar];
    const active = new Set<Command>([
      me.pace > 0 ? 'push' : me.pace < 0 ? 'save' : 'standard',
      me.stance > 0 ? 'attack' : me.stance < 0 ? 'hold' : 'race',
    ]);
    if (me.pitRequested) active.add('box');
    for (const [id, btn] of this.cmdButtons) btn.classList.toggle('on', active.has(id));
    this.bars.tyre.style.width = `${Math.round((1 - st.tyreWear) * 100)}%`;
    this.bars.fuel.style.width = `${Math.round((st.fuel / car.spec.fuelCapacity) * 100)}%`;

    if (race.phase === 'finished' && !this.resultsShown) this.showResults();
  }

  private gapText(car: RaceCar, leader: RaceCar, index: number): string {
    const { race } = this.session;
    if (car.retired) return 'Out';
    if (car.pitPhase !== PitPhase.None && !car.finished) return 'Pit';
    if (car.finished) return index === 0 ? formatTime(car.finishTime) : `+${(car.finishTime - leader.finishTime).toFixed(1)}`;
    if (race.phase === 'countdown') return '';
    if (index === 0) return 'Lead';
    const distance = leader.progress - car.progress;
    if (leader.finished) return '';
    if (distance > race.track.length) return `+${Math.floor(distance / race.track.length)}L`;
    const speed = Math.max(18, Math.hypot(car.state.vx, car.state.vy));
    return `+${(distance / speed).toFixed(1)}`;
  }

  private drawMap(focusCar: number): void {
    const ctx = this.mapCtx;
    const { scale, ox, oy } = this.mapXform;
    const { race, entries } = this.session;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.drawImage(this.mapBase, 0, 0);
    // Hazards show as yellow warning marks.
    ctx.fillStyle = '#ffd23f';
    for (const h of race.hazards) {
      const hx = Math.round(h.x * scale + ox), hy = Math.round(h.y * scale + oy);
      ctx.fillRect(hx - 2, hy - 2, 5, 5);
      ctx.clearRect(hx, hy, 1, 1);
    }
    for (let i = race.order.length - 1; i >= 0; i--) {
      const car = race.order[i];
      if (car.parked) continue;
      const x = Math.round(car.state.x * scale + ox);
      const y = Math.round(car.state.y * scale + oy);
      const focus = car.id === focusCar;
      const r = focus ? 4 : 3;
      ctx.fillStyle = focus ? '#ffffff' : '#0d0f1e';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = hex(entries[car.id].livery.base);
      ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
    }
  }

  private showResults(): void {
    this.resultsShown = true;
    const { race, entries } = this.session;
    const table = el('table');
    const winner = race.order[0];
    race.order.forEach((car, i) => {
      const tr = el('tr', entries[car.id].isPlayer ? 'player' : '');
      const gap = !car.finished ? (car.retired ? (car.retireReason === 'fuel' ? 'Out of fuel' : 'Tyre failure') : 'DNF') : i === 0 ? formatTime(car.finishTime) : `+${(car.finishTime - winner.finishTime).toFixed(3)}`;
      tr.append(
        el('td', 'num', String(i + 1)),
        el('td', '', car.driver.name),
        el('td', 'car', alias(car.spec.name)),
        el('td', 'num', gap),
        el('td', `num${car.id === race.fastestLapCar ? ' fl' : ''}`, formatTime(car.bestLap)),
      );
      table.append(tr);
    });
    this.results.replaceChildren(
      el('h1', '', this.session.counts ? 'Race result' : 'Practice over'),
      table,
      this.resultFooter?.() ?? el('div', 'foot', 'Press R for a new race'),
    );
    this.results.classList.remove('hidden');
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
