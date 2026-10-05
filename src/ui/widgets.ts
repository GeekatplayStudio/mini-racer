import { h } from './dom';
import { IconName, icon } from './icons';

type Child = Node | string | null | undefined | false;

/** Header bar of a pane: icon and name on the left, anything else pushed to the right. */
export function paneTitle(name: IconName, text: string | Node, ...right: Child[]): HTMLElement {
  return h('div', { class: 'title' }, h('span', { class: 'title-main' }, icon(name), text), ...right);
}

/** Heading of a section inside a pane, with an optional note on the right. */
export function subhead(name: IconName, text: string, note = ''): HTMLElement {
  return h('div', { class: 'subhead' }, icon(name), h('span', { text }), note ? h('span', { class: 'note', text: note }) : null);
}

/** A label and value pair for fact lists. */
export function fact(label: string, value: string, className = ''): HTMLElement[] {
  return [h('span', { class: 'dim', text: label }), h('span', { class: className, text: value })];
}

/** A big number with a caption under it. */
export function tile(value: string, label: string, className = ''): HTMLElement {
  return h('div', { class: `tile${className ? ` ${className}` : ''}` }, h('b', { text: value }), h('span', { text: label }));
}

/** Difficulty or tier as filled and empty stars. */
export function stars(count: number, of = 5): HTMLElement {
  return h('span', { class: 'stars' }, h('span', { class: 'gold', text: '★'.repeat(Math.min(of, count)) }), h('span', { class: 'off', text: '★'.repeat(Math.max(0, of - count)) }));
}
