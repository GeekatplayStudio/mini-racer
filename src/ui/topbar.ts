import { chassisName, deriveCar } from '../game/build';
import type { App } from './appTypes';
import { h, hexColor } from './dom';
import { IconName, icon, isIcon } from './icons';
import { drawFace } from './portrait';
import { ratingGrade } from './specSheet';

/** Icon for each screen's tab, by screen id. */
const TAB_ICONS: Record<string, IconName> = {
  home: 'flag',
  garage: 'wrench',
  tune: 'tune',
  drivers: 'helmet',
  history: 'trophy',
  online: 'online',
};

/** A screen tab: icon and label. */
export function tabButton(id: string, label: string, onclick: () => void): HTMLButtonElement {
  const name = TAB_ICONS[id] ?? (isIcon(id) ? id : 'dot');
  return h('button', { class: 'tab', onclick }, icon(name), h('span', { text: label }));
}

/** A square button that shows only an icon; the title is its tooltip and spoken name. */
export function iconButton(name: IconName, title: string, onclick: () => void, className = ''): HTMLButtonElement {
  const node = h('button', { class: `tab icon-btn${className ? ` ${className}` : ''}`, title, onclick }, icon(name));
  node.setAttribute('aria-label', title);
  return node;
}

export function setIcon(button: HTMLElement, name: IconName): void {
  button.replaceChildren(icon(name));
}

/** The strip in the top bar that shows which car and driver are entered. */
export function createStatus(app: Pick<App, 'profile' | 'ref' | 'go'>): { root: HTMLElement; refresh(): void } {
  const { profile } = app;
  const carChip = h('button', { class: 'status-chip', title: 'Race car: open the garage', onclick: () => app.go('garage') });
  const driverChip = h('button', { class: 'status-chip', title: 'Race driver: open drivers', onclick: () => app.go('drivers') });
  const root = h('div', { class: 'status' }, carChip, driverChip);
  let carKey = '';
  let driverKey = '';

  const refresh = (): void => {
    const car = profile.cars.find((c) => c.id === profile.selectedCar);
    const nextCar = car ? JSON.stringify(car) : '';
    if (nextCar !== carKey || !carChip.childElementCount) {
      carKey = nextCar;
      if (!car) {
        carChip.replaceChildren(icon('car'), h('span', { class: 'name dim', text: 'No car' }));
      } else {
        const d = deriveCar(car, app.ref);
        const stats = d.legal ? d.stats : null;
        carChip.replaceChildren(
          h('i', { class: 'stripe', style: { background: hexColor(car.livery.base) } }),
          h('span', { class: 'name', text: chassisName(car) }),
          stats ? h('b', { class: 'rate', text: `${stats.rating} ${ratingGrade(stats.rating)}` }) : h('b', { class: 'rate bad', text: 'Not legal' }),
        );
      }
    }
    const driver = profile.drivers.find((d) => d.def.id === profile.selectedDriver);
    const nextDriver = driver ? `${driver.def.name}|${JSON.stringify(driver.look)}` : '';
    if (nextDriver !== driverKey || !driverChip.childElementCount) {
      driverKey = nextDriver;
      if (!driver) {
        driverChip.replaceChildren(icon('helmet'), h('span', { class: 'name dim', text: 'No driver' }));
      } else {
        const face = h('canvas', { class: 'face' });
        drawFace(face, driver.look);
        driverChip.replaceChildren(face, h('span', { class: 'name', text: driver.def.name }));
      }
    }
  };
  refresh();
  return { root, refresh };
}
