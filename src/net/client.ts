import type { Profile } from '../game/profile';
import { ClientMessage, ServerMessage, WS_PATH } from './protocol';

export type NetStatus = 'signed-out' | 'offline' | 'connecting' | 'online';

/** What listeners hear: every server message, plus changes of connection state. */
export type NetEvent = ServerMessage | { t: 'status'; status: NetStatus; reason?: string };

interface Saved {
  name: string;
  token: string;
}

const STORAGE_KEY = 'miniracer.online.v1';

/**
 * Address of the game server. Normally the page's own origin; a development
 * page may name another with `?server=http://localhost:8787`. Outside
 * development only a server on this machine may be named that way, so a
 * link cannot send someone's password elsewhere.
 */
export function serverBase(): string {
  const wanted = new URLSearchParams(location.search).get('server');
  if (wanted) {
    try {
      const url = new URL(wanted);
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if ((url.protocol === 'http:' || url.protocol === 'https:') && (import.meta.env.DEV || local)) return url.origin;
    } catch {
      // Not an address: use the page's own server.
    }
  }
  return location.origin;
}

/** Sign-in, the saved team and the lobby connection, shared by every screen. */
export class NetClient {
  name = '';
  status: NetStatus = 'signed-out';
  private token = '';
  private ws: WebSocket | null = null;
  private wanted = false;
  private retries = 0;
  private retryTimer = 0;
  private readonly listeners = new Set<(ev: NetEvent) => void>();

  constructor(private readonly base = serverBase()) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
      if (saved && typeof saved.token === 'string' && typeof saved.name === 'string') {
        this.token = saved.token;
        this.name = saved.name;
        this.status = 'offline';
      }
    } catch {
      // Storage blocked: sign in each visit.
    }
  }

  get signedIn(): boolean {
    return this.token !== '';
  }

  /** Listens for messages and status changes; returns the function that stops listening. */
  subscribe(listener: (ev: NetEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: NetEvent): void {
    for (const listener of [...this.listeners]) listener(ev);
  }

  private setStatus(status: NetStatus, reason?: string): void {
    this.status = status;
    this.emit({ t: 'status', status, reason });
  }

  /** Calls the account API. Throws an Error carrying the server's reason. */
  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('Cannot reach the game server');
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 401 && this.token && path !== '/api/login') this.forget('Your session has ended; sign in again');
    if (!res.ok) throw new Error(data.error ?? `The server said no (${res.status})`);
    return data;
  }

  async signIn(name: string, password: string, register: boolean): Promise<void> {
    const out = await this.api<Saved>('POST', register ? '/api/register' : '/api/login', { name, password });
    this.token = out.token;
    this.name = out.name;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: out.name, token: out.token }));
    } catch {
      // Signed in for this visit only.
    }
    this.setStatus('offline');
    this.connect();
  }

  async signOut(): Promise<void> {
    if (this.token) await this.api('POST', '/api/logout').catch(() => undefined);
    this.forget();
  }

  /** Drops the session on this device. */
  private forget(reason?: string): void {
    this.disconnect();
    this.token = '';
    this.name = '';
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
    this.setStatus('signed-out', reason);
  }

  loadProfile(): Promise<{ profile: Profile | null; rev: number }> {
    return this.api('GET', '/api/profile');
  }

  /**
   * Uploads the team; with `base`, only over that revision of the stored one.
   * Photos stay on the device: the server drops them anyway, and a few of them
   * would take the upload past the server's size limit.
   */
  saveProfile(profile: Profile, base?: number): Promise<{ rev: number }> {
    return this.api('PUT', '/api/profile', { profile: { ...profile, photos: [] }, base });
  }

  /** Opens the lobby connection and keeps it open, reconnecting after drops. */
  connect(): void {
    if (!this.token || this.ws) return;
    this.wanted = true;
    window.clearTimeout(this.retryTimer);
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.token) this.setStatus('offline');
  }

  private open(): void {
    const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}${WS_PATH}`);
    this.ws = ws;
    this.setStatus('connecting');
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', token: this.token } satisfies ClientMessage)));
    ws.addEventListener('message', (e) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        this.retries = 0;
        this.name = msg.name;
        this.setStatus('online');
      }
      this.emit(msg);
    });
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4401) {
        this.forget('Your session has ended; sign in again');
      } else if (e.code === 4001) {
        // Another tab or device took over this account.
        this.wanted = false;
        this.setStatus('offline', 'Signed in from somewhere else');
      } else if (this.wanted) {
        this.setStatus('connecting', 'Connection lost; reconnecting');
        const delay = Math.min(10000, 500 * 2 ** this.retries++);
        this.retryTimer = window.setTimeout(() => this.open(), delay);
      } else {
        this.setStatus('offline');
      }
    });
  }

  /** Sends a message if the connection is up. False when it is not. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }
}

let shared: NetClient | null = null;

/** The one client the whole game uses. */
export function netClient(): NetClient {
  shared ??= new NetClient();
  return shared;
}
