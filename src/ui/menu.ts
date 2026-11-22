import type { Game, PracticeOptions } from '../game/game.ts';
import { h } from './screens.ts';
import { loadSettings, updateSettings, keyLabel } from '../engine/settings.ts';
import { sfx } from '../audio/sfx.ts';
import type { Difficulty } from '../gameplay/bots.ts';
import type { Mode } from '../gameplay/sim.ts';

export interface MenuHooks { openOnline?: () => void; }

export function createLoading(): { el: HTMLElement; set(p: number, msg: string): void; done(): void } {
  const bar = h('i'); const msg = h('div', { class: 'dim', style: { fontSize: '13px', letterSpacing: '.12em', textTransform: 'uppercase' } }, 'Loading');
  const el = h('div', { class: 'loading' }, h('div', { style: { fontSize: '38px', fontWeight: '900', letterSpacing: '.1em' }, html: 'HILL<span style="color:var(--sand)">FRONT</span>' }), h('div', { class: 'bar' }, bar), msg);
  document.body.appendChild(el);
  return { el, set(p, m) { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = m; }, done() { el.classList.add('out'); setTimeout(() => el.remove(), 600); } };
}

export function createMenu(game: Game, hooks: MenuHooks = {}): HTMLElement {
  const root = h('div', { id: 'menu' });
  const where = h('div', { class: 'where' }, '');
  const dlgHost = h('div', {});
  const click = (fn: () => void) => () => { sfx.unlock(); sfx.uiClick(); fn(); };

  const quick = () => game.startPractice({ mode: 'objective', difficulty: 'normal', side: 'random', perTeam: 5 });

  const nav = h('div', { class: 'nav' },
    h('button', { class: 'btn primary big', onClick: click(quick) }, '▶  Quick match (5v5 vs bots)'),
    h('button', { class: 'btn', onClick: click(() => practiceDialog()) }, 'Practice setup…'),
    h('button', { class: 'btn', onClick: click(() => (hooks.openOnline ? hooks.openOnline() : onlineFallback())) }, 'Online · Parties'),
    h('button', { class: 'btn', onClick: click(() => { root.classList.add('hidden'); game.screens.settings(() => {}, () => root.classList.remove('hidden')); }) }, 'Settings'),
    h('button', { class: 'btn', onClick: click(() => helpDialog()) }, 'How to play'));

  root.append(
    h('div', { class: 'left' },
      h('h1', { class: 'logo', html: 'HILL<br><span>FRONT</span>' }),
      h('div', { class: 'tag' }, 'Tactical team shooter · Hill Town'),
      nav,
      h('div', { class: 'foot' }, 'Original game. Models: CC0 (Toolbench, 3DAssets.dev).', h('br'), 'Offline practice needs no server.')),
    where, dlgHost);

  setInterval(() => { where.textContent = game.state === 'menu' ? game.currentVistaName : ''; }, 500);

  // ---------------------------------------------------------------- dialogs
  function modal(content: HTMLElement) {
    close();
    const el = h('div', { class: 'overlay', onClick: (e: Event) => { if (e.target === el) close(); } }, content);
    dlgHost.appendChild(el);
  }
  function close() { dlgHost.innerHTML = ''; }

  function practiceDialog() {
    const o: PracticeOptions = { mode: 'objective', difficulty: 'normal', side: 'random', perTeam: 5 };
    const render = () => {
      const seg = <T extends string | number>(cur: T, opts: [T, string][], set: (v: T) => void) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', onClick: () => { sfx.uiClick(); set(v); render(); } }, l)));
      modal(h('div', { class: 'card', style: { width: 'min(560px, 94vw)' } },
        h('h2', {}, 'Practice vs bots'),
        h('div', { class: 'dim', style: { fontSize: '13px', marginBottom: '8px' } }, 'Bots play by the same rules as you. They are not online players.'),
        h('div', { class: 'col', style: { gap: '14px' } },
          h('label', { class: 'f' }, 'Mode', seg<Mode>(o.mode, [['objective', 'Objective (plant / disarm)'], ['elimination', 'Elimination']], (v) => (o.mode = v))),
          h('label', { class: 'f' }, 'Bot difficulty', seg<Difficulty>(o.difficulty, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => (o.difficulty = v))),
          h('label', { class: 'f' }, 'Your side', seg<string>(String(o.side), [['0', 'Vanguard'], ['random', 'Random'], ['1', 'Garrison']], (v) => (o.side = v === 'random' ? 'random' : (Number(v) as 0 | 1)))),
          h('label', { class: 'f' }, 'Team size', seg<number>(o.perTeam, [[1, '1v1'], [3, '3v3'], [5, '5v5']], (v) => (o.perTeam = v))),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '6px' } },
            h('button', { class: 'btn', onClick: () => close() }, 'Cancel'),
            h('button', { class: 'btn primary', onClick: () => { sfx.unlock(); sfx.uiClick(); close(); game.startPractice({ ...o }); } }, 'Start match')))));
    };
    render();
  }

  function helpDialog() {
    const k = loadSettings().keys;
    const row = (a: string, b: string) => h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '24px', fontSize: '14px', padding: '3px 0' } }, h('span', { class: 'dim' }, a), h('span', { class: 'kbd' }, b));
    modal(h('div', { class: 'card', style: { width: 'min(760px, 95vw)' } },
      h('h2', {}, 'How to play'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '22px' } },
        h('div', {}, h('h3', {}, 'Rounds'),
          h('p', { style: { fontSize: '14px', lineHeight: '1.5', margin: '0 0 8px' } }, 'Vanguard carries a device to site A or B and plants it. Garrison must stop them, or disarm the device before its timer ends. Eliminate the other team to win the round. First to 8 rounds wins; sides swap after round 7.'),
          h('p', { style: { fontSize: '14px', lineHeight: '1.5', margin: 0 } }, 'Win rounds to earn more money. Spend it in the quartermaster during the freeze time at the start of every round.')),
        h('div', {}, h('h3', {}, 'Controls'),
          row('Move', `${keyLabel(k.forward!)} ${keyLabel(k.left!)} ${keyLabel(k.back!)} ${keyLabel(k.right!)}`), row('Fire / look', 'Mouse'), row('Jump / crouch / walk', `${keyLabel(k.jump!)} / ${keyLabel(k.crouch!)} / ${keyLabel(k.walk!)}`),
          row('Reload / inspect', `${keyLabel(k.reload!)} / ${keyLabel(k.inspect!)}`), row('Weapons', `${keyLabel(k.slot1!)} ${keyLabel(k.slot2!)} ${keyLabel(k.slot3!)} or wheel`), row('Buy menu', keyLabel(k.buy!)), row('Plant / disarm (hold)', keyLabel(k.use!)), row('Scoreboard (hold)', keyLabel(k.scoreboard!)), row('Turn without mouse capture', '← →'))),
      h('div', { class: 'dim', style: { fontSize: '12px', marginTop: '14px', lineHeight: 1.5 } }, 'Credits: soldier rig and animations — Toolbench Low-poly Squad Kit (CC0). Hill Town map kit and world weapons — 3DAssets.dev Tactical Shooter Hill Town (CC0). All audio is synthesised in your browser.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'btn', onClick: () => close() }, 'Close'))));
  }

  function onlineFallback() {
    modal(h('div', { class: 'card', style: { width: 'min(520px, 94vw)' } }, h('h2', {}, 'Online'), h('p', { class: 'dim' }, 'The online module is not loaded in this build.'), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onClick: () => close() }, 'Close'))));
  }

  // expose for the online module
  (root as any).modal = modal; (root as any).closeModal = close;
  void updateSettings;
  document.body.appendChild(root);
  return root;
}
