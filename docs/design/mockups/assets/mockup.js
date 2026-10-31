/*
 * Mockup kit core: query parameters, icons, window shell, milestone overlay.
 *   ?theme=light|dark   (default: follow the OS)
 *   ?layout=A|B         (default B — the owner's choice; A is kept for comparison)
 *   ?font=system|pretendard
 *   ?density=compact|regular|comfortable
 *   ?ms=1               milestone overlay: every element tagged data-ms gets a dashed outline
 *                       and a badge; untagged interactive elements are counted as missing
 * Page-specific parameters (state, scene, page, menu, nav, part) are read by views.js.
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
  root.dataset.layout = param('layout', ['A', 'B'], 'B');
  root.dataset.font = param('font', ['system', 'pretendard'], 'system');
  root.dataset.density = param('density', ['compact', 'regular', 'comfortable'], 'regular');
  const showMilestones = params.get('ms') === '1';
  if (showMilestones) root.dataset.msMode = '1';

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
  /** `data-ms` attribute; the label is what the screen catalogue (design-spec 10) calls the element. */
  const ms = (milestone, label) => `data-ms="${milestone}" data-ms-label="${esc(label)}"`;

  /** Palette launcher: a field-shaped button. A: title bar right; B: sidebar y 52–80 (title bar right when collapsed). */
  const launcher = () => `
    <div class="field launcher" role="button" aria-label="검색 및 명령" ${ms('M3', '⌘K 실행기')}>
      ${icon('search', 'sm')}<span class="placeholder ellipsis">검색 및 명령</span><span class="spacer"></span>${kbd('⌘', 'K')}
    </div>`;

  function tab(t) {
    const cls = ['tab', t.active ? 'is-active' : '', t.home ? 'home' : '', t.hover ? 'is-hover' : ''].join(' ');
    const close = t.home ? '' : `<span class="close" title="탭 닫기 ⌘W">${icon('x', 'sm')}</span>`;
    return `<div class="${cls}" role="tab" aria-selected="${!!t.active}" title="${esc(t.title)}">${icon(t.icon)}<span class="title ellipsis">${esc(t.title)}</span>${close}</div>`;
  }

  const toggle = (cls) =>
    `<div class="icon-btn ${cls}" title="사이드바 가리기 ⌃⌘S" ${ms('M3', '사이드바 토글')}>${icon('panel-left')}</div>`;

  /**
   * Window shell. Same DOM for both layouts; CSS grid areas place the sidebar under the
   * title bar (A) or beside it at full height (B). With a single tab (the library alone,
   * M3–M6) there is no tab strip: the title bar becomes a unified toolbar (`unified`).
   */
  function windowShell({ tabs, unified = null, sidebar = '', main, inspector = null, overlays = '', above = '', inactive = false, cls: extra = '', style = '' }) {
    const single = tabs.length <= 1;
    const cls = ['window', inspector ? 'has-inspector' : '', sidebar ? '' : 'no-sidebar', inactive ? 'is-inactive' : '', single ? 'single-tab' : '', extra].join(' ');
    const middle =
      single && unified
        ? `<div class="tb-title" ${ms(unified.ms || 'M3', unified.msLabel || '통합 도구 막대 제목')}><span class="title ellipsis">${esc(unified.title)}</span>${unified.count ? `<span class="count num">${unified.count}</span>` : ''}</div>
           <div class="tb-actions">${unified.actions || ''}</div>`
        : `<div class="tabs" role="tablist" ${ms('M7', '탭 줄')}>${tabs.map(tab).join('')}</div>`;
    return `
    <div class="${cls}" ${style ? `style="${style}"` : ''}>
      <div class="traffic-lights" aria-hidden="true"><i class="close"></i><i class="min"></i><i class="zoom"></i></div>
      <header class="titlebar">
        ${toggle('tb-toggle')}
        ${middle}
        <div class="tb-launcher">${launcher()}</div>
      </header>
      <nav class="sidebar">
        <div class="sidebar-top">${toggle('')}</div>
        <div class="launcher-wrap">${launcher()}</div>
        ${sidebar}
      </nav>
      <main class="main">${main}</main>
      ${inspector ? `<aside class="inspector">${inspector}</aside>` : ''}
      ${overlays}
      <div class="sim-badge" title="macOS 창 크롬(신호등·비브런시)은 시뮬레이션입니다">SIMULATED</div>
    </div>${above}`;
  }

  /** Standard tab set; `active` is the id of the selected tab. */
  function standardTabs(active, extra = {}) {
    return [
      { id: 'library', title: '라이브러리', icon: 'library-big', home: true },
      { id: 'pdf', title: '분자생물학 6장 · 신호 전달', icon: 'file-text' },
      { id: 'video', title: '강의 04 · 세포 신호', icon: 'clapperboard' },
      { id: 'paper', title: 'G Protein–Coupled Receptor Dynamics in Live Cells', icon: 'file-text' },
      ...(extra.more || []),
    ].map((t) => ({ ...t, active: t.id === active }));
  }

  /**
   * Pop-up menus open 4 px below their button, left-aligned (or right-aligned with data-align="end").
   * Tooltips open 6 px below their target, centred on it and kept inside their container (design-spec 6).
   */
  function placeMenus() {
    for (const tip of document.querySelectorAll('.tooltip[data-anchor]')) {
      const anchor = document.getElementById(tip.dataset.anchor);
      if (!anchor) continue;
      const r = anchor.getBoundingClientRect();
      const host = tip.offsetParent.getBoundingClientRect();
      const w = tip.offsetWidth;
      const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2 - host.left, host.width - w - 4));
      tip.style.top = `${Math.round(r.bottom - host.top + 6)}px`;
      tip.style.left = `${Math.round(left)}px`;
    }
    for (const menu of document.querySelectorAll('.menu[data-anchor]')) {
      const anchor = document.getElementById(menu.dataset.anchor);
      if (!anchor) continue;
      const r = anchor.getBoundingClientRect();
      const host = menu.offsetParent.getBoundingClientRect();
      // data-place="above": no room below (a button at the window's bottom edge) — open 4 px above it instead.
      menu.style.top = menu.dataset.place === 'above' ? `${r.top - host.top - 4 - menu.offsetHeight}px` : `${r.bottom - host.top + 4}px`;
      if (menu.dataset.align === 'end') menu.style.right = `${host.right - r.right}px`;
      else menu.style.left = `${r.left - host.left}px`;
    }
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  /** Interactive elements that must resolve to a milestone (own or ancestor `data-ms`). */
  const INTERACTIVE = [
    '.btn', '.icon-btn', '.field', '.seg', '.tab', '.chip', '.nav-row', '.table-row', '.th', '.thumb', '.cue',
    '.zoom-btn', '.speed-btn', '.mi', '.p-item', '.switch', '.checkbox', '.theme-tile', '.scrubber', '.drop-mode',
    '.collection-path', '.volume', '.toast',
    // Tutor (tutor.html)
    '.cite', '.tool', '.tu-scope', '.tu-composer', '.attach', '.agent-row', '.radio', '.proposal',
  ].join(',');

  /**
   * Milestone overlay and coverage. Writes `window.__milestones` = { tagged: [{ms,label}], missing: [...] }
   * so the render report can be checked against the screen catalogue.
   */
  function milestones() {
    const scope = document.querySelector('.window');
    const tagged = [];
    const missing = [];
    if (scope) {
      for (const el of document.querySelectorAll('[data-ms]')) {
        if (visible(el)) tagged.push({ ms: el.dataset.ms, label: el.dataset.msLabel || el.textContent.trim().slice(0, 24) });
      }
      for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!visible(el) || el.closest('[data-ms]')) continue;
        missing.push(`${el.className} “${(el.getAttribute('title') || el.textContent).trim().slice(0, 24)}”`);
      }
    }
    window.__milestones = { tagged, missing };
    if (missing.length) console.warn(`milestone coverage: ${missing.length} untagged`, missing);
    if (!showMilestones) return;
    for (const el of document.querySelectorAll('[data-ms]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = 'ms-badge';
      badge.textContent = el.dataset.ms;
      document.body.appendChild(badge);
      const w = badge.offsetWidth;
      const h = badge.offsetHeight;
      // A tag on the outline: straddles the element's top edge at its right end, so it never
      // covers the element's own glyphs, counts or dots.
      badge.style.left = `${Math.round(Math.max(2, Math.min(r.right - w - 4, innerWidth - w - 2)))}px`;
      // Small targets (dots, short rows of glyphs) get the tag fully above them.
      badge.style.top = `${Math.round(Math.max(1, r.height < 20 ? r.top - h - 2 : r.top - h / 2))}px`;
    }
  }

  /**
   * Copy lint for Korean UI text we write: a determiner (이·그·저·새·다른·각·모든·어느) and its noun,
   * and listed short compounds, must be bound with U+00A0 so a line never splits them.
   * User/document text (titles, subtitles, PDF pages) is out of scope.
   */
  const COPY = '.pe-text, .pe-title, .d-text, .ci-text, .ci-title, .notice p, .notice h2, .empty-state p, .empty-state h1, .hint, .sidebar-empty-hint, .dm-text, .t-body, .codec-notice p, .files, ' +
    '.tu-text, .tu-notice .nt, .tu-notice .nt-text, .tu-facts .f-title, .tu-facts .f-text, .tu-consent h2, .agent-row .a-text, .tu-banner, .sim-note, .tu-scope-list dd, .tu-learn-note, ' +
    // M6
    '.trash-note, .ec-head, .restore-issues';
  const COMPOUNDS = ['쪽 번호', '디스크 공간', '필기와 태그', '지운 것', '새 위치', 'G 단백질', '새 컬렉션', '어느 쪽', '원본 파일'];
  function copyLint() {
    const issues = [];
    for (const el of document.querySelectorAll(COPY)) {
      const t = el.textContent;
      for (const m of t.matchAll(/(?:^|[\s(‘“])(이|그|저|새|다른|각|모든|어느) (?=[가-힣])/g)) issues.push(`“${m[0].trim()} …” in ${el.className}`);
      for (const c of COMPOUNDS) if (t.includes(c)) issues.push(`“${c}” in ${el.className}`);
    }
    window.__copyLint = issues;
    if (issues.length) console.warn(`copy lint: ${issues.length}`, issues);
  }

  /** A conversation is scrolled to its newest message only when it overflows (`.to-end`); a short one starts at the top. */
  function scrollToEnd() {
    for (const el of document.querySelectorAll('.to-end')) {
      el.classList.remove('to-end');
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow > 1) {
        el.classList.add('to-end');
        // Scrolled past the session's title (or the title is far above): the title line under the panel head appears.
        const title = el.querySelector(':scope > .tu-title');
        const sticky = el.previousElementSibling;
        if (sticky && sticky.classList.contains('tu-sticky') && (!title || overflow > title.offsetHeight + 16)) sticky.hidden = false;
      }
    }
  }

  async function mount(html) {
    document.body.innerHTML = html;
    await document.fonts.ready;
    scrollToEnd();
    placeMenus();
    milestones();
    copyLint();
    root.dataset.ready = '1';
  }

  return { params, icon, esc, tagHex, kbd, ms, launcher, windowShell, standardTabs, mount, isDark, showMilestones };
})();
