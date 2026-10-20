/*
 * Mockup kit core: query parameters, icons, window shell.
 *   ?theme=light|dark   (default: follow the OS)
 *   ?layout=A|B         (default A)
 *   ?font=system|pretendard
 *   ?density=compact|regular|comfortable
 *   ?ms=1               show milestone badges on elements that ship after M3
 * Page-specific parameters (state, scene, page, menu, nav) are read by views.js.
 */
window.Mockup = (() => {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const param = (name, allowed, fallback) => {
    const v = params.get(name);
    return v && allowed.includes(v) ? v : fallback;
  };
  const theme = param('theme', ['light', 'dark'], null);
  if (theme) root.dataset.theme = theme;
  root.dataset.layout = param('layout', ['A', 'B'], 'A');
  root.dataset.font = param('font', ['system', 'pretendard'], 'system');
  root.dataset.density = param('density', ['compact', 'regular', 'comfortable'], 'regular');
  const showMilestones = params.get('ms') === '1';

  const isDark = () =>
    root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

  function icon(name, cls = '') {
    const body = window.MockupIcons && window.MockupIcons[name];
    if (!body) throw new Error(`Unknown icon: ${name} (run scripts/build-mockup-icons.mjs)`);
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const tagHex = (n) => `var(--tag-${n})`;
  const kbd = (...keys) => `<span class="kbd-group">${keys.map((k) => `<span class="kbd">${k}</span>`).join('')}</span>`;

  /** Palette launcher: a field-shaped button (title bar in A, sidebar in B). */
  const launcher = () => `
    <div class="field launcher" role="button" aria-label="검색 및 명령" data-ms="M3">
      ${icon('search', 'sm')}<span class="placeholder ellipsis">검색 및 명령</span><span class="spacer"></span>${kbd('⌘', 'K')}
    </div>`;

  function tab(t) {
    const cls = ['tab', t.active ? 'is-active' : '', t.home ? 'home' : '', t.hover ? 'is-hover' : ''].join(' ');
    const close = t.home ? '' : `<span class="close">${icon('x', 'sm')}</span>`;
    return `<div class="${cls}" role="tab" aria-selected="${!!t.active}" title="${esc(t.title)}">${icon(t.icon)}<span class="title ellipsis">${esc(t.title)}</span>${close}</div>`;
  }

  /**
   * Window shell. Same DOM for both layouts; CSS grid areas place the sidebar under the
   * title bar (A) or beside it at full height (B).
   */
  function windowShell({ tabs, sidebar = '', sidebarWidth, main, inspector = null, overlays = '', windowClass = '' }) {
    const cls = ['window', inspector ? 'has-inspector' : '', sidebar ? '' : 'no-sidebar', windowClass].join(' ');
    const style = sidebarWidth ? `style="--sidebar-w:${sidebarWidth}px"` : '';
    return `
    <div class="${cls}" ${style}>
      <div class="traffic-lights" aria-hidden="true"><i class="close"></i><i class="min"></i><i class="zoom"></i></div>
      <header class="titlebar">
        <div class="icon-btn a-only" title="사이드바 보기/숨기기 ⌃⌘S">${icon('panel-left')}</div>
        <div class="tabs" role="tablist" data-ms="M7">${tabs.map(tab).join('')}</div>
        <span class="spacer"></span>
        ${launcher()}
      </header>
      <nav class="sidebar">
        <div class="sidebar-top"><div class="icon-btn" title="사이드바 보기/숨기기 ⌃⌘S">${icon('panel-left')}</div></div>
        ${sidebar}
      </nav>
      <main class="main">${main}</main>
      ${inspector ? `<aside class="inspector">${inspector}</aside>` : ''}
      ${overlays}
      <div class="sim-badge" title="macOS 창 크롬(신호등·비브런시)은 시뮬레이션입니다">SIMULATED</div>
    </div>`;
  }

  /** Standard tab set; `active` is the id of the selected tab. */
  function standardTabs(active) {
    return [
      { id: 'library', title: '라이브러리', icon: 'library-big', home: true },
      { id: 'pdf', title: '분자생물학 6장 · 신호 전달', icon: 'file-text' },
      { id: 'video', title: '강의 04 · 세포 신호', icon: 'clapperboard' },
      { id: 'paper', title: 'G Protein–Coupled Receptor Dynamics in Live Cells', icon: 'file-text' },
    ].map((t) => ({ ...t, active: t.id === active }));
  }

  /** Pop-up menus open 4 px below their button, left-aligned (or right-aligned with data-align="end"). */
  function placeMenus() {
    for (const menu of document.querySelectorAll('.menu[data-anchor]')) {
      const anchor = document.getElementById(menu.dataset.anchor);
      if (!anchor) continue;
      const r = anchor.getBoundingClientRect();
      const host = menu.offsetParent.getBoundingClientRect();
      menu.style.top = `${r.bottom - host.top + 4}px`;
      if (menu.dataset.align === 'end') menu.style.right = `${host.right - r.right}px`;
      else menu.style.left = `${r.left - host.left}px`;
    }
  }

  function placeMilestones() {
    if (!showMilestones) return;
    for (const el of document.querySelectorAll('[data-ms]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const badge = document.createElement('span');
      badge.className = 'ms-badge';
      badge.textContent = el.dataset.ms;
      badge.style.left = `${Math.round(Math.min(r.right - 12, innerWidth - 26))}px`;
      badge.style.top = `${Math.round(Math.max(r.top - 6, 2))}px`;
      document.body.appendChild(badge);
    }
  }

  async function mount(html) {
    document.body.innerHTML = html;
    // Hide the layout-A-only title-bar toggle in B (B keeps it in the sidebar top).
    // B keeps the sidebar toggle inside the sidebar; when the sidebar is collapsed the
    // title bar takes over the traffic-light inset and the toggle (same as A).
    if (root.dataset.layout === 'B' && !document.querySelector('.window.no-sidebar')) {
      document.querySelectorAll('.a-only').forEach((el) => el.remove());
    }
    await document.fonts.ready;
    placeMenus();
    placeMilestones();
    root.dataset.ready = '1';
  }

  return { params, icon, esc, tagHex, kbd, launcher, windowShell, standardTabs, mount, isDark, showMilestones };
})();
