import { RacingLine, computeRacingLine } from '../sim/line';
import { Track, TrackDef } from '../sim/track';

export interface PreparedTrack {
  track: Track;
  line: RacingLine;
}

const cache = new Map<string, PreparedTrack>();

/** Builds a track and its racing line once; both are immutable afterwards. */
export function prepareTrack(def: TrackDef): PreparedTrack {
  let hit = cache.get(def.id);
  if (!hit) {
    const track = new Track(def);
    hit = { track, line: computeRacingLine(track) };
    cache.set(def.id, hit);
  }
  return hit;
}
