type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  title?: string;
  onclick?: (e: MouseEvent) => void;
  onenter?: () => void;
  onleave?: () => void;
  disabled?: boolean;
  style?: Partial<CSSStyleDeclaration>;
  data?: Record<string, string>;
}

/** Small element builder. Text always goes in as text, never as markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.onclick) node.addEventListener('click', props.onclick as EventListener);
  if (props.onenter) node.addEventListener('mouseenter', props.onenter);
  if (props.onleave) node.addEventListener('mouseleave', props.onleave);
  if (props.disabled) (node as HTMLButtonElement).disabled = true;
  if (props.style) Object.assign(node.style, props.style);
  if (props.data) for (const [k, v] of Object.entries(props.data)) node.dataset[k] = v;
  for (const child of children) if (child) node.append(child);
  return node;
}

export function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString('en-US')}`;
}

export function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function lapText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-:--.--';
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`;
}
