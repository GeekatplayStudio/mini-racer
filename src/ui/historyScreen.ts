import { TRACKS } from '../data/tracks';
import type { Photo, RaceRecord } from '../game/profile';
import type { App, Screen } from './appTypes';
import { h, lapText, money } from './dom';
import { trackTitle } from './hud';
import { paneTitle, subhead, tile } from './widgets';

function trackName(id: string): string {
  const t = TRACKS.find((x) => x.id === id);
  return t ? trackTitle(t) : id;
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function resultText(r: RaceRecord): string {
  if (r.retired) return 'DNF';
  return r.practice ? '-' : `P${r.position}`;
}

/** Race history, career statistics and the team photo album. */
export function mountHistory(app: App): Screen {
  const { profile } = app;
  const races = profile.history.filter((r) => !r.practice);
  const finished = races.filter((r) => !r.retired);

  const stat = (label: string, value: string): HTMLElement[] => [h('span', { class: 'dim', text: label }), h('span', { text: value })];
  const prize = races.reduce((s, r) => s + r.prize, 0);
  const fees = races.reduce((s, r) => s + r.fee, 0);
  const summary = h('div', { class: 'facts' },
    ...stat('Races', String(races.length)),
    ...stat('Wins', String(finished.filter((r) => r.position === 1).length)),
    ...stat('Podiums', String(finished.filter((r) => r.position <= 3).length)),
    ...stat('Did not finish', String(races.length - finished.length)),
    ...stat('Best result', finished.length ? `P${Math.min(...finished.map((r) => r.position))}` : '-'),
    ...stat('Average finish', finished.length ? `P${(finished.reduce((s, r) => s + r.position, 0) / finished.length).toFixed(1)}` : '-'),
    ...stat('Places gained', String(finished.reduce((s, r) => s + (r.grid - r.position), 0))),
    ...stat('Laps raced', String(profile.history.reduce((s, r) => s + r.lapsDone, 0))),
    ...stat('Pit stops', String(profile.history.reduce((s, r) => s + r.pitStops, 0))),
    ...stat('Prize money', money(prize)),
    ...stat('Entry fees', money(fees)),
    ...stat('Profit from racing', money(prize - fees)),
  );

  // Fastest lap at each circuit.
  const records = h('div', { class: 'facts wide' });
  for (const t of TRACKS) {
    const laps = profile.history.filter((r) => r.trackId === t.id && Number.isFinite(r.bestLap) && r.bestLap > 0);
    const best = laps.sort((a, b) => a.bestLap - b.bestLap)[0];
    records.append(h('span', { class: 'dim', text: trackTitle(t) }), h('span', { text: best ? `${lapText(best.bestLap)}  ${best.driver}` : 'No lap yet' }));
  }

  // Per-driver record.
  const drivers = h('div', { class: 'hist-table drivers-table' });
  drivers.append(...['Driver', 'Races', 'Wins', 'Podiums', 'DNF', 'Prize'].map((t) => h('span', { class: 'th', text: t })));
  const names = [...new Set(races.map((r) => r.driver))];
  for (const name of names) {
    const mine = races.filter((r) => r.driver === name);
    const done = mine.filter((r) => !r.retired);
    drivers.append(
      h('span', { class: 'gold', text: name }),
      h('span', { text: String(mine.length) }),
      h('span', { text: String(done.filter((r) => r.position === 1).length) }),
      h('span', { text: String(done.filter((r) => r.position <= 3).length) }),
      h('span', { text: String(mine.length - done.length) }),
      h('span', { text: money(mine.reduce((s, r) => s + r.prize, 0)) }),
    );
  }
  if (!names.length) drivers.append(h('span', { class: 'dim', style: { gridColumn: '1 / -1' }, text: 'No races yet.' }));

  const showPhoto = (p: Photo): void => {
    const img = h('img');
    img.src = p.data;
    img.alt = p.caption;
    const link = h('a', { class: 'btn', text: 'Save image' });
    link.href = p.data;
    link.download = `miniracer-${p.kind}-${dateText(p.date)}.jpg`;
    // Photos fill browser storage fastest: the player can make room.
    const remove = h('button', { class: 'btn warn', text: 'Delete photo', onclick: () => {
      app.closeDialog();
      app.confirm('Delete this photo? It cannot be brought back.', 'Delete', () => {
        profile.photos = profile.photos.filter((x) => x.id !== p.id);
        for (const r of profile.history) if (r.photo === p.id) r.photo = undefined;
        app.commit();
        app.go('history');
      }, true);
    } });
    app.dialog(p.caption, [img, h('div', { class: 'actions' }, link, remove)]);
  };

  const album = h('div', { class: 'album' });
  for (const p of profile.photos) {
    const img = h('img');
    img.src = p.data;
    img.alt = p.caption;
    album.append(h('div', { class: 'shot', title: p.caption, onclick: () => showPhoto(p) }, img, h('span', { text: p.kind === 'finish' ? 'Finish line' : 'Team photo' })));
  }
  if (!profile.photos.length) album.append(h('div', { class: 'dim', text: 'No photos yet. Take a team photo on the Race tab, or finish a race for a finish-line shot.' }));

  const table = h('div', { class: 'hist-table races-table' });
  table.append(...['Date', 'Circuit', 'Result', 'Grid', 'Laps', 'Best lap', 'Stops', 'Prize', 'Driver', 'Car', ''].map((t) => h('span', { class: 'th', text: t })));
  for (const r of profile.history) {
    const photo = r.photo ? profile.photos.find((p) => p.id === r.photo) : undefined;
    const cls = r.retired ? 'bad' : r.position === 1 && !r.practice ? 'gold' : '';
    table.append(
      h('span', { class: 'dim', text: dateText(r.date) }),
      h('span', { text: trackName(r.trackId) }),
      h('span', { class: cls, text: r.practice ? 'Practice' : `${resultText(r)}/${r.entries}${r.retired ? ` ${r.retired}` : ''}` }),
      h('span', { text: r.practice ? '-' : `P${r.grid}` }),
      h('span', { text: `${r.lapsDone}/${r.laps}` }),
      h('span', { text: lapText(r.bestLap) }),
      h('span', { text: String(r.pitStops) }),
      h('span', { class: r.prize > 0 ? 'good' : 'dim', text: r.practice ? '-' : money(r.prize) }),
      h('span', { text: r.driver }),
      h('span', { class: 'dim', text: r.car }),
      photo ? h('button', { class: 'btn', text: 'Photo', onclick: () => showPhoto(photo) }) : h('span'),
    );
  }
  if (!profile.history.length) table.append(h('span', { class: 'dim', style: { gridColumn: '1 / -1' }, text: 'Nothing yet. Every practice and race you run is listed here.' }));

  const wins = finished.filter((r) => r.position === 1).length;
  const tiles = h('div', { class: 'tiles' },
    tile(String(races.length), 'Races'),
    tile(String(wins), 'Wins', wins ? 'good' : ''),
    tile(String(finished.filter((r) => r.position <= 3).length), 'Podiums'),
    tile(finished.length ? `P${Math.min(...finished.map((r) => r.position))}` : '-', 'Best'),
  );
  const left = h('div', { class: 'pane hi-left' }, paneTitle('trophy', 'Career'), h('div', { class: 'scroll t-body' },
    tiles,
    subhead('chart', 'Career'), summary,
    subhead('clock', 'Fastest laps'), records,
    subhead('helmet', 'Drivers'), drivers,
    subhead('camera', 'Photo album', String(profile.photos.length)), album,
  ));
  const right = h('div', { class: 'pane hi-right' }, paneTitle('clock', 'Race history', h('span', { text: `${profile.history.length} sessions` })), h('div', { class: 'scroll t-body' }, table));

  app.garage.autoRotate = true;
  app.garage.setFocus(null);
  app.garage.setViewShift(0);
  return { root: h('div', {}, left, right) };
}
