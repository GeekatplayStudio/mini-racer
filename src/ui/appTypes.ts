import type { Profile } from '../game/profile';
import type { PreparedTrack } from '../game/trackCache';
import type { GarageView } from '../render/garageView';

export type ScreenId = 'home' | 'garage' | 'tune' | 'drivers' | 'history';

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
  /** In-game panel with any content and a close button. */
  dialog(title: string, content: Node[]): void;
  startRace(practice: boolean): void;
}

export interface Screen {
  root: HTMLElement;
  dispose?(): void;
}
