import type { Profile } from '../game/profile';
import type { PreparedTrack } from '../game/trackCache';
import type { GarageView } from '../render/garageView';
import type { OnlineRace } from './onlineScreen';

export type ScreenId = 'home' | 'garage' | 'tune' | 'drivers' | 'history' | 'online';

/** What every screen gets from the application shell. */
export interface App {
  profile: Profile;
  /** Benchmark track for lap-time estimates. */
  ref: PreparedTrack;
  garage: GarageView;
  /** Persists the profile and refreshes the top bar. */
  commit(): void;
  go(screen: ScreenId): void;
  toast(message: string, bad?: boolean): void;
  /** In-game yes/no question; runs onYes when confirmed. */
  confirm(message: string, yesLabel: string, onYes: () => void, danger?: boolean): void;
  /** In-game panel with any content and a close button; pass closeButton false when the content has its own. */
  dialog(title: string, content: Node[], closeButton?: boolean): void;
  closeDialog(): void;
  startRace(practice: boolean): void;
  /** Shows a race the game server runs. */
  enterOnline(race: OnlineRace): void;
}

export interface Screen {
  root: HTMLElement;
  dispose?(): void;
}
