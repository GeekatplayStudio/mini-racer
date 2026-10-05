import type { CarBuild } from '../game/build';
import type { RaceRecord } from '../game/profile';
import type { DriverDef } from '../sim/driver';
import type { Command, PitMode, RaceOptions, Weather } from '../sim/race';
import type { Snapshot } from '../sim/snapshot';

/**
 * Messages between the game and its server. Accounts and the saved team go
 * over plain HTTP (see api.ts); the lobby and the races go over one WebSocket
 * as JSON text, each message an object with a type tag `t`.
 */

export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;
export const GRID_MIN = 2;
export const GRID_MAX = 12;
export const LAPS_MAX = 60;
export const HAZARDS_MAX = 18;
export const WEAR_MAX = 15;
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'snow'];
/** Path of the WebSocket endpoint on the game server. */
export const WS_PATH = '/ws';

/** What the host chooses when opening a game. */
export interface GameRules {
  trackId: string;
  laps: number;
  /** Cars on the grid, humans and bots together. */
  grid: number;
  /** Seats for human teams; the rest of the grid is bots. */
  humans: number;
  wearScale: number;
  hazards: number;
  weather: Weather;
}

/** A game in the lobby list. */
export interface GameInfo extends GameRules {
  id: string;
  host: string;
  /** Human seats taken. */
  filled: number;
}

export interface SeatInfo {
  name: string;
  ready: boolean;
  connected: boolean;
  /** What the team has entered, once chosen. */
  car: string | null;
  driver: string | null;
}

/** The game a player is sitting in, before the start. */
export interface RoomInfo extends GameRules {
  id: string;
  host: string;
  /** One per human seat; null is an open seat. */
  seats: (SeatInfo | null)[];
}

/** One car on the grid as both sides need it to build the same race. */
export interface OnlineEntrant {
  build: CarBuild;
  driver: DriverDef;
  /** Account name of the team on the pit wall; absent for bots. */
  owner?: string;
  pitMode?: PitMode;
}

/** Everything needed to construct the race, entrants in grid order. */
export interface OnlineRaceSetup {
  trackId: string;
  laps: number;
  seed: number;
  options: RaceOptions;
  entrants: OnlineEntrant[];
}

export interface ResultRow {
  position: number;
  driver: string;
  /** Account name; absent for bots. */
  owner?: string;
  finished: boolean;
}

export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'list' }
  | ({ t: 'create' } & GameRules)
  | { t: 'join'; game: string }
  | { t: 'leave' }
  | { t: 'entry'; car: CarBuild; driver: DriverDef; pitMode?: PitMode }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'cmd'; command: Command };

export type ServerMessage =
  /** Sent once the token is accepted. `rev` is the revision of the team saved on the server, 0 for none. */
  | { t: 'hello'; name: string; rev: number }
  | { t: 'games'; games: GameInfo[] }
  /** The room the player sits in; null after leaving or when the game closes. */
  | { t: 'room'; room: RoomInfo | null; reason?: string }
  | { t: 'error'; message: string }
  /** The race starts (or, with `resumed`, the player is back in one that is running). */
  | { t: 'race'; setup: OnlineRaceSetup; you: number; fee: number; rev: number; resumed: boolean }
  | { t: 'snap'; s: Snapshot }
  /** The player's own result, banked on the server. */
  | { t: 'result'; position: number; classified: boolean; prize: number; record: RaceRecord; rev: number; standings: ResultRow[] };

export const COMMAND_IDS: readonly Command[] = ['push', 'standard', 'save', 'attack', 'race', 'hold', 'box', 'stayout'];
