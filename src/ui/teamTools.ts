import type { App } from './appTypes';
import { h } from './dom';

// SHA-256 of "user:password". This is a client-side lock: it keeps casual
// players out of test mode, but anyone who reads the code or edits the save
// can get past it. It is not real security.
const ACCESS_DIGEST = 'beb344d4783d166220bab7660f6377a9ac96ec2cbd01644c2114221de591a1ad';
const MAX_TRIES = 5;
const LOCK_SECONDS = 60;
const WRONG_DELAY_MS = 600;
const LOCK_KEY = 'miniracer.tools.lock';

let failures = 0;
let lockedUntil = 0;
try {
  lockedUntil = Number(localStorage.getItem(LOCK_KEY)) || 0;
} catch {
  // Storage can be blocked; the lock then lasts for this visit only.
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function lock(): void {
  failures = 0;
  lockedUntil = Date.now() + LOCK_SECONDS * 1000;
  try {
    localStorage.setItem(LOCK_KEY, String(lockedUntil));
  } catch {
    // See above.
  }
}

/** The team tools button: asks for the team login, or offers to leave test mode when it is on. */
export function openTeamTools(app: App, onChange: () => void): void {
  const { profile } = app;
  if (profile.admin) {
    app.confirm('Test mode is on: parts are free and locked settings can be edited.', 'Leave test mode', () => {
      profile.admin = false;
      app.commit();
      app.toast('Test mode off');
      onChange();
    });
    return;
  }

  const field = (label: string, type: string, name: string): [HTMLElement, HTMLInputElement] => {
    const input = h('input');
    input.type = type;
    input.name = name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 40;
    return [h('label', { class: 'form-row' }, h('span', { class: 'dim', text: label }), input), input];
  };
  const [userRow, user] = field('User name', 'text', 'tools-user');
  const [passRow, pass] = field('Password', 'password', 'tools-pass');
  const message = h('div', { class: 'form-msg' });
  const submit = h('button', { class: 'btn go', text: 'Unlock' });
  submit.type = 'submit';
  const cancel = h('button', { class: 'btn', text: 'Cancel', onclick: () => app.closeDialog() });
  cancel.type = 'button';
  const form = h('form', { class: 'form tools-form' },
    h('div', { class: 'modal-text', text: 'Test mode is for the team. Sign in to switch it on.' }),
    userRow, passRow, message,
    h('div', { class: 'actions' }, cancel, submit),
  );

  let busy = false;
  let timer = 0;
  const show = (): void => {
    const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
    const locked = wait > 0;
    user.disabled = pass.disabled = submit.disabled = locked || busy;
    if (locked) {
      message.className = 'form-msg bad';
      message.textContent = `Too many wrong tries. Try again in ${wait} s.`;
    } else if (message.textContent?.startsWith('Too many')) {
      message.textContent = '';
    }
    if (!form.isConnected && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
  timer = window.setInterval(show, 500);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy || lockedUntil > Date.now()) return;
    if (!globalThis.crypto?.subtle) {
      message.className = 'form-msg bad';
      message.textContent = 'Sign-in is not available on this connection.';
      return;
    }
    busy = true;
    message.className = 'form-msg dim';
    message.textContent = 'Checking...';
    show();
    void digest(`${user.value.trim().toLowerCase()}:${pass.value}`).then((hex) => {
      if (hex === ACCESS_DIGEST) {
        failures = 0;
        profile.admin = true;
        app.commit();
        app.closeDialog();
        app.toast('Test mode on: everything is free and unlocked');
        onChange();
        return;
      }
      // A short wait slows down guessing.
      window.setTimeout(() => {
        busy = false;
        failures += 1;
        pass.value = '';
        if (failures >= MAX_TRIES) lock();
        else {
          message.className = 'form-msg bad';
          message.textContent = `Wrong user name or password. ${MAX_TRIES - failures} ${MAX_TRIES - failures === 1 ? 'try' : 'tries'} left.`;
        }
        show();
        if (!pass.disabled) pass.focus();
      }, WRONG_DELAY_MS);
    });
  });

  app.dialog('Team tools', [form], false);
  show();
  user.focus();
}
