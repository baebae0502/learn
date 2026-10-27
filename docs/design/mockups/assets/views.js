/*
 * Screen templates. Each `Mockup.render(name)` call composes the window shell with a view.
 * Page parameters (see docs/design/design-spec.md, 부록 A):
 *   library        ?state=none|multi|noresults|loading|empty-collection
 *   library-empty  ?state=drop
 *   reader-pdf     ?page=original|sepia|dark &menu=zoom|view &nav=thumbs|outline &state=loading|error|missing|nooutline
 *   reader-video   ?state=nosubs|nomatch
 *   palette        ?state=none
 *   dialogs        ?scene=duplicate|recovery|backup|codec
 *   components     ?part=1|2|3|4|5 (4–5 = tutor)
 *   tutor          ?state=1…10 and the variants listed at the top of tutor.html
 * Every interactive element carries (or sits inside) a `data-ms` milestone; `?ms=1` shows them.
 */
(() => {
  const M = window.Mockup;
  const D = window.MockupData;
  const { icon, esc, kbd, tagHex, params, ms } = M;
  const state = params.get('state');

  // ── Shared bits ────────────────────────────────────────────────────────────
  const navRow = ({ label, ic, count, indent = 0, selected, focused, cursor, children, open, muted, cls = '', tag }) => {
    const classes = ['nav-row', selected ? 'is-selected' : '', focused ? 'is-focused' : '', cursor ? 'is-cursor' : '', muted ? 'is-muted' : '', cls].join(' ');
    const disclosure = children ? `<span class="disclosure">${icon(open ? 'chevron-down' : 'chevron-right', 'xs')}</span>` : '';
    const c = count === undefined || count === null ? '' : `<span class="count">${count}</span>`;
    return `<div class="${classes}" style="--indent:${indent}" role="treeitem" ${tag ? ms(tag[0], tag[1]) : ''}>${disclosure}${icon(ic)}<span class="label ellipsis">${esc(label)}</span>${c}</div>`;
  };

  const tagChip = (n, extra = '') => {
    const t = Object.values(D.tags).find((x) => x.color === n);
    return `<span class="chip ${extra}"><span class="dot" style="background:${tagHex(n)}"></span>${esc(t.name)}</span>`;
  };

  const kindIcon = (kind) => (kind === 'video' ? 'clapperboard' : 'file-text');

  /** Web-drawn pop-up menu item (only for pop-up buttons inside the content, ADR-0005). */
  const mi = (label, { check, shortcut, active, disabled, title } = {}) =>
    `<div class="mi ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}" ${title ? `title="${esc(title)}"` : ''}><span class="check">${check ? icon('check', 'sm') : ''}</span><span>${label}</span>${shortcut ? `<span class="shortcut">${shortcut}</span>` : ''}</div>`;

  // ── Library: sidebar ───────────────────────────────────────────────────────
  function librarySidebar({ empty = false, selected = 'molbio', focused = false, extra = '', collapsed = false } = {}) {
    // Special views appear only when they have content (design-spec 6, 트리).
    const specials = empty
      ? [{ id: 'all', label: '내 라이브러리', ic: 'library-big', tag: ['M4', '내 라이브러리'] }]
      : [
          { id: 'all', label: '내 라이브러리', ic: 'library-big', count: 128, tag: ['M4', '내 라이브러리'] },
          { id: 'recent', label: '최근 연 자료', ic: 'clock', tag: ['M5', '최근 연 자료'] },
          { id: 'unfiled', label: '미분류', ic: 'inbox', count: 12, tag: ['M5', '미분류'] },
          { id: 'dupes', label: '중복 항목', ic: 'copy', count: 2, tag: ['M5', '중복 항목'] },
          { id: 'trash', label: '휴지통', ic: 'trash-2', count: 3, tag: ['M6', '휴지통'] },
        ];
    const lib = specials.map((r) => navRow({ ...r, selected: r.id === selected, focused: r.id === selected && focused })).join('');

    let tree = '';
    if (empty) {
      tree = `<div class="sidebar-empty-hint">컬렉션이 없습니다. 자료를 묶으려면 새&nbsp;컬렉션을 만드세요.</div>`;
    } else {
      for (const c of D.collections) {
        const open = c.open && !collapsed;
        tree += navRow({
          label: c.name, ic: open ? 'folder-open' : 'folder', count: c.count, children: !!c.children, open,
          selected: c.id === selected, focused: c.id === selected && focused,
        });
        if (open) {
          for (const ch of c.children) {
            tree += navRow({ label: ch.name, ic: 'folder', count: ch.count, indent: 1, selected: ch.id === selected, focused: ch.id === selected && focused });
          }
        }
      }
    }

    const tagsHtml = empty
      ? ''
      : `<div class="tag-selector" ${ms('M5', '태그 선택기(표시 메뉴·필터)')}>
          <div class="head">태그<span class="spacer"></span><span class="icon-btn sm" title="태그 표시: 현재 보기의 태그만 · 모든 태그 · 이름순/많이 쓴 순">${icon('ellipsis', 'sm')}</span></div>
          <div class="tag-cloud">
            ${[1, 2, 4, 5].map((n) => tagChip(n)).join('')}
            ${D.plainTags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
            ${D.dimTags.map((t) => `<span class="chip is-dim">${esc(t)}</span>`).join('')}
          </div>
          <div class="field small">${icon('search', 'sm')}<span class="placeholder">태그 필터</span></div>
        </div>`;

    return `
      <div class="sidebar-scroll" role="tree">
        <div class="section-label">라이브러리</div>
        ${lib}
        <div ${ms('M5', '컬렉션 트리·새 컬렉션')}>
          <div class="section-label">컬렉션<span class="spacer"></span><span class="icon-btn sm" title="새 컬렉션 ⇧⌘N">${icon('folder-plus', 'sm')}</span></div>
          ${tree}
        </div>
        ${extra}
      </div>
      ${tagsHtml}`;
  }

  // ── Library: table ─────────────────────────────────────────────────────────
  const COLS = 'minmax(0, 1fr) 156px 52px 104px 120px';

  function progressCell(p) {
    if (p === null) return `<span class="c-tertiary">—</span>`;
    if (p === 100) return `<span class="inline-flag c-success">${icon('check', 'sm')}완료</span>`;
    return `<span class="progress"><i style="width:${p}%"></i></span><span class="pct">${p}%</span>`;
  }

  function tableRow(it, { selected, focused, hover, cursor, firstDots }) {
    const cls = ['table-row', selected ? 'is-selected' : '', focused ? 'is-focused' : '', hover ? 'is-hover' : '', cursor ? 'is-cursor' : '', it.missing ? 'is-missing' : ''].join(' ');
    const dots = it.tags.length
      ? `<span class="tag-dots" ${firstDots ? ms('M5', '표의 색 점') : ''}>${it.tags.map((n) => `<i style="background:${tagHex(n)}"></i>`).join('')}</span>`
      : '';
    const linked = it.linked ? `<span class="c-tertiary" title="외부 파일 연결">${icon('link', 'sm')}</span>` : '';
    const flag = it.missing
      ? `<span class="inline-flag c-warning" title="원본&nbsp;파일을 찾을 수 없습니다">${icon('triangle-alert', 'sm')}파일 없음</span>`
      : it.unplayable
        ? `<span class="inline-flag c-warning" title="이 동영상 형식은 재생할 수 없습니다">${icon('video-off', 'sm')}재생 불가</span>`
        : '';
    return `<div class="${cls}" role="row" aria-selected="${!!selected}">
      <div class="td" role="gridcell">${icon(kindIcon(it.kind))}<span class="title ellipsis">${esc(it.title)}</span>${linked}${dots}${flag}</div>
      <div class="td" role="gridcell"><span class="ellipsis">${esc(it.authors)}</span></div>
      <div class="td num" role="gridcell">${it.year}</div>
      <div class="td" role="gridcell">${progressCell(it.progress)}</div>
      <div class="td num" role="gridcell"><span class="ellipsis">${esc(it.added)}</span></div>
    </div>`;
  }

  function tableHead() {
    return [
      ['제목', ''], ['저자', ''], ['연도', ''], ['진행', ''], ['추가일', 'is-sorted'],
    ]
      .map(([l, c]) => `<div class="th ${c}" role="columnheader" ${l === '진행' ? ms('M7', '진행 열') : ''}>${l}${c ? icon('chevron-down', 'xs') : ''}</div>`)
      .join('');
  }

  function libraryTable({ selectedIds = [1], focused = true, cursorId = null, body = null } = {}) {
    let firstDotsDone = false;
    const rows =
      body ??
      D.items
        .map((it) => {
          const firstDots = !firstDotsDone && it.tags.length > 0;
          if (firstDots) firstDotsDone = true;
          return tableRow(it, { selected: selectedIds.includes(it.id), focused, cursor: it.id === cursorId, firstDots });
        })
        .join('');
    return `<div class="table" role="grid" style="--cols:${COLS}" ${ms('M4', '항목 표(정렬·열 구성·선택)')}>
      <div class="table-head" role="row">${tableHead()}</div>
      <div class="table-body">${rows}</div>
    </div>`;
  }

  const importButton = () =>
    `<div class="btn has-icon has-menu" title="가져오기 — 파일 가져오기… ⌘O · 외부 파일 연결… ⌥⌘O" ${ms('M3', '가져오기 단추·메뉴')}>${icon('plus')}가져오기${icon('chevron-down', 'xs')}</div>`;

  function libraryHeader({ title = '분자생물학', count = '48개', search = null, inspectorOn = true, toggleTitle = '항목 패널 가리기 ⌥⌘I', toggleMs = ['M4', '항목 패널 토글'] } = {}) {
    const field = search
      ? `<div class="field is-focus" style="width:240px" ${ms('M4', '빠른 검색')}>${icon('search', 'sm')}<span class="value">${esc(search)}</span><span class="caret"></span><span class="spacer"></span><span title="검색어 지우기">${icon('circle-x', 'sm')}</span></div>`
      : `<div class="field" style="width:240px" ${ms('M4', '빠른 검색')}>${icon('search', 'sm')}<span class="placeholder ellipsis">제목, 저자, 태그 검색</span></div>`;
    return `<div class="pane-header">
      <span class="title ellipsis">${esc(title)}</span>${count ? `<span class="count num">${count}</span>` : ''}
      <span class="spacer"></span>
      ${importButton()}
      ${field}
      <div class="icon-btn ${inspectorOn ? 'is-on' : ''}" title="${toggleTitle}" ${ms(toggleMs[0], toggleMs[1])}>${icon('panel-right')}</div>
    </div>`;
  }

  // ── Library: inspector ─────────────────────────────────────────────────────
  const sectionHead = (title, extra = '') =>
    `<div class="section-head">${icon('chevron-down', 'xs')}<span>${title}</span><span class="spacer"></span>${extra}</div>`;

  function inspectorItem() {
    const it = D.selectedItem;
    const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    const r = it.reading;
    return `<div class="inspector-scroll">
      <div class="item-head" ${ms('M4', '항목 패널 머리(열기·Finder에서 보기)')}>
        <div class="kind">${icon('file-text', 'sm')}${esc(it.kind)} · ${r.pages}쪽</div>
        <h2>${esc(it.title)}</h2>
        <div class="authors">${esc(it.authors)} · 2024</div>
        <div class="actions">
          <div class="btn primary" title="열기 ↩">열기</div>
          <div class="btn has-icon" title="Finder에서 보기 ⇧⌘R">${icon('folder-search')}Finder에서 보기</div>
        </div>
      </div>
      <section class="section" ${ms('M7', '읽기 절')}>
        ${sectionHead('읽기')}
        <div class="row gap-8"><span class="progress wide thick"><i style="width:${r.percent}%"></i></span><span class="pct t-footnote">${r.percent}%</span></div>
        <div class="t-footnote c-secondary" style="margin-top:4px"><span class="num">${r.page} / ${r.pages}쪽</span>에서 멈춤 · ${esc(r.opened)}</div>
      </section>
      <section class="section" ${ms('M4', '정보 절·편집')}>
        ${sectionHead('정보', `<span class="icon-btn sm" title="정보 편집">${icon('pencil', 'sm')}</span>`)}
        ${kv(it.info)}
      </section>
      <section class="section" ${ms('M5', '태그 절')}>
        ${sectionHead('태그', `<span class="icon-btn sm" title="태그 추가">${icon('plus', 'sm')}</span>`)}
        <div class="tag-cloud">${it.tags.map((n) => tagChip(n)).join('')}${it.plainTags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </section>
      <section class="section" ${ms('M5', '컬렉션 절')}>
        ${sectionHead('컬렉션')}
        ${it.collections
          .map((path) => `<div class="collection-path">${icon('folder', 'sm')}${path.map(esc).join(`<span class="sep">›</span>`)}</div>`)
          .join('')}
      </section>
      <section class="section" ${ms('M4', '파일 절·해시 복사')}>
        ${sectionHead('파일')}
        <dl class="kv">${it.file.map(([k, v]) => `<dt>${k}</dt><dd class="ellipsis">${esc(v)}</dd>`).join('')}
          <dt>SHA-256</dt><dd class="row gap-6"><span class="mono c-secondary" title="${it.shaFull}">${it.sha}</span><span class="icon-btn sm" title="전체 SHA-256 복사">${icon('copy', 'sm')}</span></dd>
        </dl>
      </section>
    </div>`;
  }

  function inspectorNone({ stats = true } = {}) {
    return `<div class="pane-empty" ${ms('M4', '선택 없음 항목 패널')}>
      ${icon('mouse-pointer-2')}
      <div class="pe-title">선택한 자료 없음</div>
      <div class="pe-text">표에서 자료를 고르면 정보와 읽기 진행이 여기에 보입니다.</div>
      ${stats ? `<div class="pe-text c-tertiary" style="margin-top:12px">분자생물학 · 자료 48개(PDF 35 · 동영상 13) · 1.9 GB</div>` : ''}
    </div>`;
  }

  function inspectorMulti(ids) {
    const items = ids.map((id) => D.items.find((x) => x.id === id));
    return `<div class="inspector-scroll" ${ms('M4', '다중 선택 항목 패널')}>
      <div class="item-head">
        <div class="kind">${icon('files', 'sm')}PDF ${items.length}개 · 합계 9.8 MB</div>
        <h2>자료 ${items.length}개 선택</h2>
        <div class="multi-list">${items.map((it) => `<div class="collection-path">${icon(kindIcon(it.kind), 'sm')}<span class="ellipsis">${esc(it.title)}</span></div>`).join('')}</div>
        <div class="actions">
          <div class="btn primary" title="선택한 자료를 각각 탭으로 엽니다 ↩" ${ms('M7', '탭 여러 개로 열기')}>탭 ${items.length}개로 열기</div>
          <div class="btn has-menu" title="컬렉션에 추가" ${ms('M5', '컬렉션에 추가 메뉴')}>컬렉션에 추가${icon('chevron-down', 'xs')}</div>
        </div>
      </div>
      <section class="section" ${ms('M5', '공통 태그 절')}>
        ${sectionHead('공통 태그')}
        <div class="t-footnote c-secondary">세 자료에 함께 붙은 태그가 없습니다.</div>
        <div class="tag-cloud" style="margin-top:8px"><span class="chip add">${icon('plus', 'sm')}모두에 태그 추가</span></div>
      </section>
      <section class="section" ${ms('M5', '공통 컬렉션 절')}>
        ${sectionHead('컬렉션')}
        <div class="collection-path">${icon('folder', 'sm')}분자생물학</div>
      </section>
    </div>`;
  }

  function libraryWindow(opts = {}) {
    const st = opts.state ?? state;
    let header = libraryHeader(opts.header);
    let table;
    let insp;
    let sidebar = librarySidebar(opts.sidebar);
    if (st === 'none') {
      table = libraryTable({ selectedIds: [], focused: true });
      insp = inspectorNone();
    } else if (st === 'multi') {
      table = libraryTable({ selectedIds: [1, 3, 6], focused: true, cursorId: 6 });
      insp = inspectorMulti([1, 3, 6]);
    } else if (st === 'noresults') {
      header = libraryHeader({ count: '0개 / 48개', search: '효소 억제제' });
      table = libraryTable({
        body: `<div class="pane-empty top" ${ms('M4', '검색 결과 없음')}>
          ${icon('search-x')}
          <div class="pe-title">‘효소 억제제’와 일치하는 자료가 없습니다</div>
          <div class="pe-text">이&nbsp;컬렉션의 제목·저자·태그에서 찾았습니다.</div>
          <div class="row gap-8" style="margin-top:8px"><div class="btn">검색어 지우기</div><div class="btn">내 라이브러리 전체에서 찾기</div></div>
        </div>`,
      });
      insp = inspectorNone();
    } else if (st === 'loading') {
      header = libraryHeader({ count: '' });
      table = libraryTable({
        body: `<div class="pane-empty top" ${ms('M4', '불러오는 중')}><div class="loading"><span class="spinner"></span>불러오는 중…</div></div>`,
      });
      insp = inspectorNone({ stats: false });
    } else if (st === 'empty-collection') {
      header = libraryHeader({ title: '학회 준비', count: '0개' });
      sidebar = librarySidebar({ selected: 'conf', focused: true });
      table = libraryTable({
        body: `<div class="pane-empty top" ${ms('M5', '빈 컬렉션')}>
          ${icon('folder-open')}
          <div class="pe-title">이&nbsp;컬렉션은 비어 있습니다</div>
          <div class="pe-text">다른&nbsp;컬렉션의 자료를 사이드바의 ‘학회 준비’로 끌어&nbsp;놓거나, 파일을 바로 이&nbsp;컬렉션으로 가져오세요.</div>
          <div class="btn" style="margin-top:8px">이&nbsp;컬렉션으로 가져오기…</div>
        </div>`,
      });
      insp = `<div class="pane-empty" ${ms('M5', '빈 컬렉션 항목 패널')}>${icon('folder')}<div class="pe-title">학회 준비</div><div class="pe-text">자료 0개 · 2026. 10. 21. 만듦</div></div>`;
    } else {
      table = libraryTable(opts.table);
      insp = inspectorItem();
    }
    return M.windowShell({
      tabs: M.standardTabs('library'),
      sidebar,
      main: header + table,
      inspector: insp,
      overlays: opts.overlays || '',
      above: opts.above || '',
      inactive: !!opts.inactive,
    });
  }

  // ── Library: empty + drop overlay ──────────────────────────────────────────
  function emptyLibrary(drop) {
    const main = `<div class="empty-state" ${ms('M3', '빈 라이브러리 안내')}>
        <div class="glyph">${icon('library-big', 'xl')}</div>
        <h1>아직 자료가 없습니다</h1>
        <p>PDF나 동영상을 이&nbsp;창에 끌어다 놓거나 가져올 파일을 선택하세요.<br>원본은 그대로 두고 라이브러리에 사본을 만듭니다.</p>
        <div class="actions">
          <div class="btn primary large" title="⌘O">파일 가져오기…</div>
          <div class="btn large" title="⌥⌘O">외부 파일 연결…</div>
        </div>
        <div class="hints">
          <div class="row"><span>파일 가져오기</span>${kbd('⌘', 'O')}<span style="width:12px"></span><span>명령 팔레트</span>${kbd('⌘', 'K')}</div>
          <div class="row">PDF와 MP4 · MOV · WebM 동영상을 지원합니다.</div>
        </div>
      </div>`;
    return M.windowShell({
      tabs: [{ title: '라이브러리', icon: 'library-big', home: true, active: true }],
      unified: { title: '내 라이브러리', actions: importButton() },
      sidebar: `<div ${ms('M5', '컬렉션 없음 안내')}>${librarySidebar({ empty: true, selected: 'all', focused: false })}</div>`,
      main,
      overlays: drop ? dropOverlay() : '',
    });
  }

  function dropOverlay() {
    return `<div class="drop-overlay" role="dialog" aria-label="파일 놓기" ${ms('M3', '드롭 오버레이')}>
      <div class="frame"></div>
      <div class="drop-panel">
        <div class="glyph">${icon('download', 'xl')}</div>
        <h1>놓으면 라이브러리로 가져옵니다</h1>
        <div class="files">파일 3개(PDF 2 · 동영상 1)</div>
        <div class="drop-modes">
          <div class="drop-mode is-on">${icon('copy')}<span class="dm-title">사본으로 가져오기</span>
            <span class="dm-text">라이브러리 폴더에 복사합니다.<br>원본은 그대로 둡니다.</span></div>
          <div class="drop-mode is-off">${icon('link')}<span class="dm-title">외부 파일로 연결${kbd('⌥')}</span>
            <span class="dm-text">복사하지 않고 원래 위치의 파일을 그대로 씁니다.</span></div>
        </div>
      </div>
    </div>`;
  }

  // ── PDF reader ─────────────────────────────────────────────────────────────
  // Page bodies are written once and reused: full size in the stage, scaled in thumbnails.
  const P = {
    a: '세포는 주변 환경의 변화를 감지하고 그에 맞게 반응해야 살아남을 수 있다. 호르몬, 성장 인자, 신경 전달 물질처럼 세포 밖에서 오는 신호는 대부분 세포막을 직접 통과하지 못하므로, 세포 표면의 수용체가 신호를 받아 세포 안으로 전달한다.',
    b: '수용체에 신호 분자가 결합하면 수용체의 입체 구조가 바뀌고, 이 변화가 세포질 쪽에 있는 단백질을 활성화한다. 활성화된 단백질은 다시 다른 단백질을 활성화하거나 작은 분자를 만들어 신호를 이어 간다.',
    c: '이처럼 신호가 여러 단계를 거쳐 전달되는 과정을 신호 전달 경로라고 한다. 경로의 각 단계는 신호를 키우거나, 다른 경로의 신호와 합치거나, 신호를 세포의 여러 부분으로 나누어 보내는 역할을 한다.',
    d: 'G 단백질 연결 수용체는 일곱 번 세포막을 통과하는 구조를 가진 수용체로, 사람 유전체에서 가장 큰 수용체 무리를 이룬다. 빛, 냄새, 맛을 감지하는 수용체도 대부분 이 무리에 속한다.',
    e: 'cAMP는 아데닐산 고리화효소가 ATP로부터 만드는 작은 분자로, 세포질 안에서 빠르게 퍼져 단백질 인산화효소 A를 활성화한다. 활성화된 인산화효소는 여러 표적 단백질에 인산기를 붙여 그 활성을 바꾼다.',
    f: '칼슘 이온 역시 중요한 2차 전령이다. 평소에는 세포질의 칼슘 농도가 매우 낮게 유지되지만, 신호가 오면 소포체에 저장된 칼슘이 방출되어 농도가 순간적으로 높아진다.',
  };
  const para = (k, cls = '') => `<p class="${cls}">${P[k]}</p>`;
  const running = `<div class="running"><span>6장 신호 전달</span><span>분자생물학 3판</span></div>`;
  const plainFigure = (h, label) =>
    `<figure class="fig"><svg width="520" height="${h}" viewBox="0 0 520 ${h}"><rect x="0" y="0" width="520" height="${h}" rx="8" fill="currentColor" fill-opacity="0.05"/><rect x="40" y="${h / 2 - 22}" width="120" height="44" rx="6" fill="#6b5ca5" fill-opacity="0.7"/><rect x="200" y="${h / 2 - 22}" width="120" height="44" rx="6" fill="#2f7fb6" fill-opacity="0.7"/><rect x="360" y="${h / 2 - 22}" width="120" height="44" rx="6" fill="#2a9d8f" fill-opacity="0.7"/></svg><figcaption><b>${label}</b> ${P.b.slice(0, 46)}</figcaption></figure>`;

  function pageBody(n, { find = true } = {}) {
    const fh = (cls = '', word = '증폭') => (find ? `<span class="find-hit ${cls}">${word}</span>` : word);
    switch (n) {
      case 40:
        return `${running}${para('a', 'no-indent')}${para('b')}${plainFigure(170, '그림 6-2')}${para('c')}${para('d')}${para('f')}<div class="folio">40</div>`;
      case 41:
        return `${running}${para('e', 'no-indent')}<h3>6.4 신호 ${fh()}</h3>${para('c')}${para('a')}${plainFigure(150, '그림 6-3')}${para('b')}<p>이 과정은 짧은 시간 안에 끝나며, 신호 분자가 사라지면 수용체도 원래 상태로 돌아간다.</p><div class="folio">41</div>`;
      case 42:
        return `${running}
        <h4>연쇄 반응과 ${fh('current')} 배율</h4>
        <p>세포 밖의 신호 분자 하나가 수용체에 결합하면 세포 안에서는 여러 단계의 효소 반응이 차례로 일어난다. 각 단계에서 활성화된 분자는 다음 단계의 분자를 여러 개 활성화하므로, 처음의 작은 신호는 단계를 거칠수록 커진다.</p>
        <p><span class="hl" ${find ? ms('M9', '하이라이트·여백 노트') : ''}>하나의 활성 수용체는 결합해 있는 동안 수백 개의 G 단백질을 활성화할 수 있고, 활성화된 아데닐산 고리화효소 하나는 1초에 수천 개의 cAMP를 만든다.</span> 단계마다 곱해지는 이 배율 덕분에 호르몬 분자 몇 개만으로도 세포 전체의 대사가 바뀐다.</p>
        <figure class="fig">${cascadeFigure()}
          <figcaption><b>그림 6-4</b> 신호 ${fh()} 단계. 원의 수는 각 단계에서 활성화되는 분자의 상대적인 양을, 화살표의 굵기는 신호의 세기를 나타낸다.</figcaption>
        </figure>
        <p>전체 ${fh()} 배율은 각 단계 배율의 곱으로 근사할 수 있다. 예를 들어 수용체 하나가 G 단백질 100개를 활성화하고, 고리화효소 하나가 cAMP 100개를 만든다면 이 두 단계만으로 신호는 만 배가 된다. 실제 세포에서는 신호를 끄는 반응이 동시에 일어나므로 배율은 이보다 작다.</p>
        <p>신호의 세기는 ${fh()}뿐 아니라 각 분자가 활성 상태로 머무는 시간에도 달려 있다. G 단백질의 GTP 가수분해 속도가 느릴수록 한 번의 자극이 더 오래 지속된다.</p>
        <div class="box"><b>핵심 정리</b><ul><li>연쇄 반응의 각 단계는 신호를 곱으로 키운다.</li><li>신호를 끄는 반응의 속도가 실제 배율을 결정한다.</li></ul></div>
        <div class="folio">42</div>`;
      case 43:
        return `${running}${para('f', 'no-indent')}${para('e')}${plainFigure(190, '그림 6-5')}${para('a')}${para('c')}${para('b')}<div class="folio">43</div>`;
      default:
        return `${running}<h4>2차 전령의 역할</h4>${para('e', 'no-indent')}${para('f')}${para('d')}${para('a')}${para('c')}${para('b')}<div class="folio">${n}</div>`;
    }
  }

  /** First page of the English paper (no outline in the PDF). Fictional authors and institute. */
  function paperPage() {
    const p = (t) => `<p>${t}</p>`;
    return `<div class="pdf-page paper" aria-label="1쪽">
      <div class="paper-head">
        <div class="paper-kicker">Research Article</div>
        <h3>G Protein–Coupled Receptor Dynamics in Live Cells</h3>
        <div class="paper-authors">Mara Okafor, Henrik Lindqvist</div>
        <div class="paper-aff">Department of Cell Biology, Northfield Institute (fictional)</div>
      </div>
      <div class="paper-abstract"><b>Abstract</b> Receptor activation is usually described as a switch, yet single-cell imaging shows a continuum of short-lived states. We tracked labelled receptors at the plasma membrane and measured how long each state lasts before G protein coupling. Brief activations were common and rarely produced downstream signals, while longer ones were amplified several hundred fold.</div>
      <div class="paper-cols">
        ${p('<b>Introduction.</b> Cells read their environment through receptors that span the plasma membrane. The largest family couples to heterotrimeric G proteins, which in turn regulate enzymes that produce second messengers.')}
        ${p('How a single binding event becomes a measurable response has been studied mostly in bulk. Bulk assays average away the timing of individual activations, which is where amplification begins.')}
        ${p('Here we follow individual receptors in living cells and relate the duration of each active state to the signal it produces. We find that duration, not the number of receptors bound, best predicts the response.')}
        ${p('<b>Results.</b> Labelled receptors were imaged at 20 frames per second. Active states shorter than 200 ms produced no detectable second messenger; states longer than one second produced a response that scaled with duration.')}
        ${p('The relationship held across ligand concentrations, suggesting that cells measure time rather than occupancy. A simple two-step model reproduces the data when G protein coupling is rate limiting.')}
      </div>
      <div class="folio">1</div>
    </div>`;
  }

  function thumbs(current = 42) {
    return `<div class="thumbs" ${ms('M7', '썸네일')}><div class="thumbs-inner" style="transform:translateY(-104px)">${[40, 41, 42, 43, 44]
      .map((n) => `<div class="thumb ${n === current ? 'is-current' : ''}"><div class="thumb-page"><div class="pdf-page">${pageBody(n, { find: false })}</div></div><span class="lbl">${n}</span></div>`)
      .join('')}</div></div>`;
  }

  function outline() {
    return `<div class="outline" role="tree" ${ms('M7', '목차')}>${D.outline
      .map((o) => {
        const cls = ['nav-row', o.current ? 'is-selected' : ''].join(' ');
        const disc = o.lvl === 0 && o.open ? `<span class="disclosure">${icon('chevron-down', 'xs')}</span>` : '';
        return `<div class="${cls}" style="--indent:${o.lvl}">${disc}<span class="label ellipsis">${esc(o.t)}</span><span class="page">${o.p}</span></div>`;
      })
      .join('')}</div>`;
  }

  function pdfSidebar(nav, { mode = 'normal', sessions = null, current = 42 } = {}) {
    const seg = (id, label, tag) => `<span class="seg ${nav === id ? 'is-on' : ''}" ${tag ? ms(tag[0], tag[1]) : ''}>${label}</span>`;
    // `sessions`: the tutor mockup's 4th segment (this item's sessions, T1) and its list when nav === 'sessions'.
    const head = `<div class="reader-nav-head">
        <div class="segmented fill ${mode === 'loading' ? 'is-disabled' : ''}" ${ms('M7', '썸네일·목차 전환')}>${seg('thumbs', '썸네일')}${seg('outline', '목차')}${seg('notes', '필기', ['M9', '필기 칸'])}${sessions ? seg('sessions', '세션', ['T1', '세션 칸(이 자료의 세션)']) : ''}</div>
      </div>`;
    if (nav === 'sessions' && sessions) return `${head}${sessions}`;
    if (mode === 'nooutline') {
      return `${head}<div class="pane-empty top" ${ms('M7', '목차 없음')}>${icon('list-tree')}<div class="pe-title">이&nbsp;PDF에는 목차가 없습니다</div><div class="pe-text">썸네일에서 쪽을 고르거나 ${kbd('⌥', '⌘', 'G')}로 쪽&nbsp;번호를 입력하세요.</div></div>`;
    }
    if (mode === 'loading') {
      // Reading position is being restored to p. 42: placeholders around it, current ring on 42.
      return `${head}<div class="thumbs" ${ms('M7', '썸네일 불러오는 중')}><div class="thumbs-inner" style="transform:translateY(-104px)">${[40, 41, 42, 43, 44]
        .map((n) => `<div class="thumb ${n === 42 ? 'is-current' : ''}"><div class="thumb-page placeholder"></div><span class="lbl">${n}</span></div>`)
        .join('')}</div></div>`;
    }
    const search =
      nav === 'outline'
        ? `<div class="nav-search" ${ms('M7', '목차 검색')}><div class="field small">${icon('search', 'sm')}<span class="placeholder">목차에서 찾기</span></div></div>`
        : '';
    return `${head}${search}${nav === 'outline' ? outline() : thumbs(current)}`;
  }

  function cascadeFigure() {
    const stages = [
      { label: '수용체', n: '1', dots: 1, r: 9 },
      { label: 'G 단백질', n: '~10²', dots: 6, r: 6 },
      { label: '고리화효소', n: '~10²', dots: 6, r: 6 },
      { label: 'cAMP', n: '~10⁴', dots: 15, r: 3.5 },
      { label: '인산화 표적', n: '~10⁶', dots: 28, r: 2.5 },
    ];
    const colW = 112;
    const fills = ['#6b5ca5', '#d9822b', '#2f7fb6', '#2a9d8f', '#58707d'];
    let svg = '';
    stages.forEach((s, i) => {
      const cx = 56 + i * colW;
      const cols = Math.ceil(Math.sqrt(s.dots));
      const gap = s.r * 2 + 4;
      const rows = Math.ceil(s.dots / cols);
      for (let k = 0; k < s.dots; k++) {
        const x = cx - ((cols - 1) * gap) / 2 + (k % cols) * gap;
        const y = 78 - ((rows - 1) * gap) / 2 + Math.floor(k / cols) * gap;
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.r}" fill="${fills[i]}"/>`;
      }
      svg += `<text x="${cx}" y="150" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${s.label}</text>`;
      svg += `<text x="${cx}" y="168" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.65">${s.n}</text>`;
      if (i < stages.length - 1) {
        const w = 1 + i * 1.2;
        svg += `<line x1="${cx + 34}" y1="78" x2="${cx + colW - 40}" y2="78" stroke="currentColor" stroke-opacity="0.55" stroke-width="${w}"/>`;
        svg += `<path d="M${cx + colW - 44} ${78 - 3 - w} L${cx + colW - 34} 78 L${cx + colW - 44} ${78 + 3 + w} Z" fill="currentColor" fill-opacity="0.55"/>`;
      }
    });
    return `<svg width="560" height="180" viewBox="0 0 560 180" font-family="inherit" role="img" aria-label="신호 증폭 단계">
      <rect x="4" y="22" width="552" height="112" rx="10" fill="currentColor" fill-opacity="0.035"/>${svg}</svg>`;
  }

  function pdfPages({ find }) {
    return `<div class="pdf-scroll" style="top:-1083px">
      <div class="pdf-page" aria-label="41쪽">${pageBody(41, { find })}</div>
      <div class="pdf-page" aria-label="42쪽">${pageBody(42, { find })}
        <span class="margin-note" style="left:716px;top:186px" title="노트">${icon('sticky-note')}</span>
      </div>
    </div>`;
  }

  function zoomMenu() {
    return `<div class="menu" data-anchor="zoom-btn" style="width:232px" role="menu" ${ms('M7', '확대·축소·확대 메뉴')}>
      ${mi('자동 맞춤')}${mi('너비에 맞춤')}${mi('한 쪽 전체 보기')}${mi('실제 크기', { shortcut: '⌘0' })}
      <div class="msep"></div>
      ${mi('75%')}${mi('100%', { check: true })}${mi('125%', { active: true })}${mi('150%')}${mi('200%')}
      <div class="msep"></div>
      ${mi('확대', { shortcut: '⌘+' })}${mi('축소', { shortcut: '⌘−' })}
    </div>`;
  }

  function viewMenu() {
    return `<div class="menu" data-anchor="view-btn" data-align="end" style="width:232px" role="menu" ${ms('M7', '보기 메뉴')}>
      <div class="mhead">스크롤</div>${mi('세로로 이어서', { check: true })}${mi('가로로 이어서')}${mi('한 쪽씩')}
      <div class="msep"></div>
      <div class="mhead">펼침</div>${mi('펼치지 않음', { check: true })}${mi('홀수 쪽부터')}${mi('짝수 쪽부터')}
      <div class="msep"></div>
      <div class="mhead">쪽 색</div>${mi('앱 테마 따르기')}${mi('원본')}${mi('세피아', { check: true })}${mi('어둡게', { active: true })}
      <div class="msep"></div>
      ${mi('시계 방향으로 회전', { shortcut: '⌘R' })}${mi('반시계 방향으로 회전', { shortcut: '⌘L' })}
    </div>`;
  }

  function pdfToolbar({ menu = null, find = true, disabled = false, page = '42', pages = '68', zoom = '100%', trailing = '', tools = 'full' } = {}) {
    const dis = disabled ? 'is-disabled' : '';
    return `<div class="reader-toolbar">
      <div class="group" ${ms('M7', '뒤로·앞으로')}>
        <span class="icon-btn ${dis}" title="뒤로 ⌘[">${icon('arrow-left')}</span>
        <span class="icon-btn is-disabled" title="앞으로 ⌘]">${icon('arrow-right')}</span>
      </div>
      <span class="toolbar-sep"></span>
      <div class="page-field ${dis}" ${ms('M7', '쪽 입력')}><div class="field">${page}</div><span class="num">/ ${pages}</span></div>
      <span class="spacer"></span>
      <div class="group" ${ms('M7', '확대·축소·확대 메뉴')}>
        <span class="icon-btn ${dis}" title="축소 ⌘−">${icon('zoom-out')}</span>
        <span class="zoom-btn ${menu === 'zoom' ? 'is-on' : ''} ${dis}" id="zoom-btn" title="확대 비율">${zoom}${icon('chevron-down', 'xs')}</span>
        <span class="icon-btn ${dis}" title="확대 ⌘+">${icon('zoom-in')}</span>
      </div>
      <span class="spacer"></span>
      ${
        // tools: 'compact' = the tutor mockup's narrow-reader step — the annotation group folds into one menu button.
        tools === 'compact'
          ? `<span class="btn small plain has-icon has-menu ${dis}" title="필기 도구 — 하이라이트 H · 밑줄 U · 노트 N · 펜 P · 지우개 E · 필기 색" ${ms('M9', '필기 도구 묶음(좁은 리더에서 ‘필기 ▾’로 접힘)')}>${icon('highlighter', 'sm')}필기${icon('chevron-down', 'xs')}</span>`
          : `<div class="group tool-group ${dis}" ${ms('M9', '필기 도구 묶음')}>
        <span class="icon-btn" title="하이라이트 H">${icon('highlighter')}</span>
        <span class="icon-btn" title="밑줄 U">${icon('underline')}</span>
        <span class="icon-btn" title="노트 N">${icon('sticky-note')}</span>
        <span class="icon-btn" title="펜 P">${icon('pen-line')}</span>
        <span class="icon-btn" title="지우개 E">${icon('eraser')}</span>
        <span class="icon-btn with-caret" title="필기 색 · 노랑 (1–8)"><span class="color-dot" style="background:var(--tag-1)"></span>${icon('chevron-down', 'xs')}</span>
      </div>`
      }
      <span class="toolbar-sep"></span>
      <span class="icon-btn ${find && !disabled ? 'is-on' : ''} ${dis}" title="찾기 ⌘F" ${ms('M7', '찾기 단추·찾기 막대')}>${icon('search')}</span>
      <span class="btn small plain has-menu ${menu === 'view' ? 'is-pressed' : ''} ${dis}" id="view-btn" title="보기: 스크롤·펼침·쪽 색·회전" ${ms('M7', '보기 메뉴')}>보기${icon('chevron-down', 'xs')}</span>
      ${trailing}
    </div>`;
  }

  function findBar() {
    return `<div class="find-bar" role="search" ${ms('M7', '찾기 단추·찾기 막대')}>
      <div class="field is-focus">${icon('search', 'sm')}<span class="value">증폭</span><span class="caret"></span><span class="spacer"></span><span class="count">3 / 12</span></div>
      <span class="icon-btn sm" title="이전 ⇧⌘G">${icon('chevron-up', 'sm')}</span>
      <span class="icon-btn sm" title="다음 ⌘G">${icon('chevron-down', 'sm')}</span>
      <span class="icon-btn sm" title="대소문자 구분">${icon('case-sensitive', 'sm')}</span>
      <span class="icon-btn sm" title="닫기 esc">${icon('x', 'sm')}</span>
    </div>`;
  }

  function pdfWindow() {
    const menu = params.get('menu');
    const nav = params.get('nav') === 'outline' ? 'outline' : 'thumbs';
    const pageParam = params.get('page');
    const page = ['original', 'sepia', 'dark'].includes(pageParam) ? pageParam : M.isDark() ? 'dark' : 'original';
    document.documentElement.dataset.page = page;

    // Transient states keep the reader toolbar (disabled); final states replace it with a title
    // row, like the unplayable-video screen (rubric 8: transient = disabled, final = hidden).
    if (state === 'loading') {
      const main = `${pdfToolbar({ find: false, disabled: true })}
        <div class="reader-body"><div class="pdf-stage"><div class="pdf-scroll" style="top:24px"><div class="pdf-page placeholder" ${ms('M7', 'PDF 여는 중')}><div class="stage-center"><div class="loading"><span class="spinner"></span>42쪽을 여는 중…</div></div></div></div></div></div>`;
      return M.windowShell({ tabs: M.standardTabs('pdf'), sidebar: pdfSidebar('thumbs', { mode: 'loading' }), main });
    }
    if (state === 'error' || state === 'missing' || state === 'locked') {
      const doc = {
        error: { id: 'broken', title: 'Ion Channels in Excitable Membranes', meta: 'Lindqvist · 2018 · PDF' },
        missing: { id: 'missing', title: 'Calcium Signaling Revisited', meta: 'Ishikawa, Petrov · 2024 · 외부 연결' },
        locked: { id: 'locked', title: 'Receptor Tyrosine Kinases: Structure and Function', meta: 'Brennan, Osei · 2019 · PDF' },
      }[state];
      const tabs = M.standardTabs(doc.id, { more: [{ id: doc.id, title: doc.title, icon: 'file-text' }] });
      const stage = {
        error: `<div class="notice" role="status" ${ms('M7', 'PDF 열기 실패(손상)')}>
            <div class="glyph">${icon('file-x', 'xl')}</div>
            <h2>이&nbsp;PDF를 열 수 없습니다</h2>
            <p>파일 내용이 손상되어 쪽을 읽을 수 없습니다. 원본&nbsp;파일은 그대로 보관됩니다. 다른&nbsp;사본이 있으면 다시 가져오세요.</p>
            <div class="file">ion-channels-excitable.pdf · 2.3 MB</div>
            <div class="actions"><div class="btn has-icon" title="⇧⌘R">${icon('folder-search')}Finder에서 보기</div><div class="btn has-icon">${icon('external-link')}기본 앱으로 열기</div></div>
          </div>`,
        locked: `<div class="notice" role="status" ${ms('M7', '암호로 보호된 PDF(암호 입력)')}>
            <div class="glyph">${icon('lock', 'xl')}</div>
            <h2>암호로 보호된 PDF입니다</h2>
            <p>암호를 입력하면 이&nbsp;탭에서 엽니다. 암호는 저장하지 않으므로 다음에 열 때 다시 묻습니다.</p>
            <div class="file">receptor-tyrosine-kinases.pdf · 5.6 MB</div>
            <div class="actions"><div class="btn primary" title="↩">암호 입력…</div><div class="btn has-icon" title="⇧⌘R">${icon('folder-search')}Finder에서 보기</div></div>
          </div>`,
        missing: `<div class="notice" role="status" ${ms('M3', '원본 없음(다시 연결)')}>
            <div class="glyph warning">${icon('link-2-off', 'xl')}</div>
            <h2>원본&nbsp;파일을 찾을 수 없습니다</h2>
            <p>외부 연결 자료입니다. 파일을 옮겼거나 이름을 바꿨다면 새&nbsp;위치를 지정하세요. 필기와&nbsp;태그는 그대로 남아 있습니다.</p>
            <div class="file mono" title="/Users/seojin/Downloads/papers/calcium-signaling.pdf">~/Downloads/papers/calcium-signaling.pdf</div>
            <div class="actions"><div class="btn primary">다시 연결…</div><div class="btn">라이브러리로 돌아가기</div></div>
          </div>`,
      }[state];
      const main = `<div class="reader-toolbar"><span class="t-headline ellipsis media-title">${esc(doc.title)}</span><span class="c-tertiary t-footnote ellipsis">${doc.meta}</span></div>
        <div class="reader-body"><div class="pdf-stage"><div class="stage-center">${stage}</div></div></div>`;
      const sidebar =
        state === 'locked'
          ? `<div class="pane-empty top" ${ms('M7', '쪽 없음')}>${icon('lock')}<div class="pe-title">암호를 입력하면 쪽이 보입니다</div></div>`
          : `<div class="pane-empty top" ${ms('M7', '쪽 없음')}>${icon('file-x')}<div class="pe-title">표시할 쪽이 없습니다</div></div>`;
      return M.windowShell({ tabs, sidebar, main });
    }

    if (state === 'nooutline') {
      const main = `${pdfToolbar({ find: false, page: '1', pages: '14' })}
        <div class="reader-body"><div class="pdf-stage"><div class="pdf-scroll" style="top:24px">${paperPage()}</div></div></div>`;
      return M.windowShell({ tabs: M.standardTabs('paper'), sidebar: pdfSidebar('outline', { mode: 'nooutline' }), main });
    }

    // The find bar is open in every state except when the view menu covers it; closing it clears the matches.
    const find = menu !== 'view';
    const main = `${pdfToolbar({ menu, find })}
      <div class="reader-body"><div class="pdf-stage">${pdfPages({ find })}${find ? findBar() : ''}</div></div>
      ${menu === 'zoom' ? zoomMenu() : ''}${menu === 'view' ? viewMenu() : ''}`;
    return M.windowShell({ tabs: M.standardTabs('pdf'), sidebar: pdfSidebar(nav), main });
  }

  // ── Video reader ───────────────────────────────────────────────────────────
  function lectureSlide() {
    const dots = (x, y, n, r, color, cols) =>
      Array.from({ length: n }, (_, k) => `<circle cx="${x + (k % cols) * (r * 2 + 6)}" cy="${y + Math.floor(k / cols) * (r * 2 + 6)}" r="${r}" fill="${color}"/>`).join('');
    return `<svg viewBox="0 0 1600 900" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" font-family="Pretendard Variable, sans-serif" role="img" aria-label="강의 슬라이드">
      <rect width="1600" height="900" fill="#f7f7f3"/>
      <rect x="0" y="0" width="1600" height="12" fill="#2a6f6b"/>
      <text x="96" y="132" font-size="58" font-weight="700" fill="#1f2a30">cAMP 경로: 단계마다 커지는 신호</text>
      <text x="96" y="186" font-size="28" fill="#5d6a70">수용체 하나가 수천 개의 표적 단백질을 움직이는 원리</text>
      <rect x="96" y="300" width="1408" height="56" rx="8" fill="#e9dfc7"/>
      <text x="1490" y="337" text-anchor="end" font-size="22" fill="#8a7a55">세포막</text>
      <rect x="196" y="252" width="44" height="152" rx="18" fill="#6b5ca5"/>
      <circle cx="218" cy="228" r="22" fill="#e0a458"/>
      <text x="218" y="460" text-anchor="middle" font-size="26" font-weight="600" fill="#1f2a30">수용체</text>
      <text x="218" y="494" text-anchor="middle" font-size="22" fill="#5d6a70">1개</text>
      <path d="M262 390 C330 420 360 420 420 410" stroke="#1f2a30" stroke-width="3" fill="none"/>
      <path d="M420 410 l-16 -10 l2 18 z" fill="#1f2a30"/>
      ${dots(440, 380, 6, 15, '#d9822b', 3)}
      <text x="490" y="500" text-anchor="middle" font-size="26" font-weight="600" fill="#1f2a30">G 단백질</text>
      <text x="490" y="534" text-anchor="middle" font-size="22" fill="#5d6a70">수백 개</text>
      <path d="M560 400 C620 410 660 410 712 400" stroke="#1f2a30" stroke-width="5" fill="none"/>
      <path d="M716 399 l-18 -12 l2 22 z" fill="#1f2a30"/>
      ${dots(736, 376, 6, 15, '#2f7fb6', 3)}
      <text x="786" y="500" text-anchor="middle" font-size="26" font-weight="600" fill="#1f2a30">고리화효소</text>
      <text x="786" y="534" text-anchor="middle" font-size="22" fill="#5d6a70">수백 개</text>
      <path d="M856 400 C920 420 960 430 1010 440" stroke="#1f2a30" stroke-width="8" fill="none"/>
      <path d="M1016 441 l-22 -14 l0 26 z" fill="#1f2a30"/>
      ${dots(1036, 410, 40, 6, '#2a9d8f', 10)}
      <text x="1140" y="560" text-anchor="middle" font-size="26" font-weight="600" fill="#1f2a30">cAMP</text>
      <text x="1140" y="594" text-anchor="middle" font-size="22" fill="#5d6a70">수천 개 이상</text>
      <rect x="96" y="680" width="1408" height="120" rx="14" fill="#ffffff" stroke="#d9d6cc"/>
      <text x="136" y="732" font-size="28" font-weight="600" fill="#2a6f6b">증폭 배율 ≈ 각 단계 배율의 곱</text>
      <text x="136" y="774" font-size="24" fill="#5d6a70">100 (G 단백질) × 100 (cAMP) = 10,000배</text>
      <text x="96" y="864" font-size="20" fill="#8d979b">분자생물학 · 강의 04 · 윤재하</text>
      <text x="1504" y="864" text-anchor="end" font-size="20" fill="#8d979b">17</text>
    </svg>`;
  }

  /** Opening slide of lecture 05 (used where the lecture has not been played yet). */
  function titleSlide() {
    return `<svg viewBox="0 0 1600 900" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" font-family="Pretendard Variable, sans-serif" role="img" aria-label="강의 첫 슬라이드">
      <rect width="1600" height="900" fill="#1f3b3a"/>
      <rect x="96" y="360" width="80" height="8" fill="#7fd1c9"/>
      <text x="96" y="460" font-size="84" font-weight="700" fill="#ffffff">2차 전령</text>
      <text x="96" y="530" font-size="32" fill="#b9d3d0">cAMP · 칼슘 · IP₃ — 신호를 세포 안으로 퍼뜨리는 분자들</text>
      <text x="96" y="800" font-size="24" fill="#8fb1ad">분자생물학 · 강의 05 · 윤재하</text>
    </svg>`;
  }

  function videoSidebar(mode = 'normal') {
    const head = `<div class="reader-nav-head">
        <div class="segmented fill" ${ms('M8', '대본 칸')}><span class="seg is-on">대본</span><span class="seg" ${ms('M9', '시간 메모 칸')}>시간 메모</span></div>
      </div>`;
    if (mode === 'nosubs') {
      return `${head}<div class="pane-empty top" ${ms('M8', '자막 없음')}>
        ${icon('captions-off')}
        <div class="pe-title">자막이 없습니다</div>
        <div class="pe-text">SRT나 VTT 자막 파일을 추가하면 대본이 여기에 표시되고, 문장을 눌러 그&nbsp;시간으로 이동할 수 있습니다.</div>
        <div class="btn">자막 파일 추가…</div>
      </div>`;
    }
    const query = mode === 'nomatch' ? '칼슘 펌프' : '증폭';
    const field = `<div class="nav-search" ${ms('M8', '대본 검색')}><div class="field small">${icon('search', 'sm')}<span class="value">${query}</span><span class="spacer"></span><span class="c-tertiary num">${mode === 'nomatch' ? '0개' : '2개'}</span></div></div>`;
    if (mode === 'nomatch') {
      return `${head}${field}<div class="pane-empty top" ${ms('M8', '대본 검색 결과 없음')}>
        ${icon('search-x')}
        <div class="pe-title">‘칼슘 펌프’가 나오는 문장이 없습니다</div>
        <div class="pe-text">자막 파일의 글자에서만 찾습니다. 다른&nbsp;낱말로 찾아보세요.</div>
      </div>`;
    }
    const currentIndex = D.cues.findIndex((c) => c[2] === 'current');
    // "Follow current position" keeps the current cue in the upper third: start a few cues earlier.
    const first = Math.max(0, currentIndex - 3);
    const cues = D.cues
      .slice(first)
      .map(([ts, tx, st], j) => {
        const i = j + first;
        const cur = st === 'current';
        const past = !cur && i < currentIndex;
        const text = esc(tx).replace('증폭', '<mark>증폭</mark>');
        return `<div class="cue ${cur ? 'is-current' : ''} ${past ? 'is-past' : ''}"><span class="ts">${ts}</span><span class="tx">${text}</span></div>`;
      })
      .join('');
    return `${head}${field}
      <div class="transcript" ${ms('M8', '대본 목록')}>${cues}</div>
      <div class="transcript-foot" ${ms('M8', '현재 위치 따라가기')}><span class="switch is-on"></span><span>현재 위치 따라가기</span></div>`;
  }

  function videoControls({ played = 35.2, time = '18:20', total = '52:10', memos = true, captions = true } = {}) {
    const marks = memos
      ? `<span class="memo-marks" ${ms('M9', '메모 점')}>${D.memos.map((m) => `<span class="memo-mark" style="left:${m.at * 100}%;background:${tagHex(m.color)}"></span>`).join('')}</span>`
      : '';
    return `<div class="video-controls" ${ms('M8', '재생 컨트롤(±10초·속도·자막·음량·전체 화면)')}>
      <div class="scrubber"><div class="track"><span class="buffered" style="width:${played ? 58 : 6}%"></span><span class="played" style="width:${played}%"></span>${marks}<span class="knob" style="left:${played}%"></span></div></div>
      <div class="control-row">
        <span class="icon-btn" title="10초 뒤로 J">${icon('rotate-ccw')}</span>
        <span class="icon-btn" title="재생 K / 스페이스" style="color:var(--text-primary)">${icon('play', 'lg')}</span>
        <span class="icon-btn" title="10초 앞으로 L">${icon('rotate-cw')}</span>
        <span class="time"><b>${time}</b> / ${total}</span>
        <span class="spacer"></span>
        <span class="speed-btn" title="재생 속도 ⇧, ⇧.">1.25×</span>
        <span class="icon-btn ${captions ? 'is-on' : 'is-disabled'}" title="${captions ? '자막 켜기/끄기 C' : '자막 없음'}">${icon('captions')}</span>
        <div class="volume"><span class="icon-btn" title="음소거 M">${icon('volume-2')}</span><span class="vtrack"><i></i></span></div>
        <span class="icon-btn" title="전체 화면 F">${icon('maximize')}</span>
      </div>
    </div>`;
  }

  function videoMain({ codec = false, mode = 'normal' } = {}) {
    const nosubs = mode === 'nosubs';
    const title = codec ? '수용체 탈감작 세미나 녹화' : nosubs ? '강의 05 · 2차 전령' : '강의 04 · 세포 신호';
    const meta = codec ? '정민호 · 외부 연결' : nosubs ? '윤재하 · 2025 · 47분' : '윤재하 · 2025 · 52분';
    const head = `<div class="reader-toolbar">
      <span class="t-headline ellipsis media-title">${title}</span>
      <span class="c-tertiary t-footnote ellipsis">${meta}</span>
      <span class="spacer"></span>
      ${codec ? '' : `<span class="btn small plain has-icon has-menu" title="자막: 한국어 · 끄기 · 자막 파일 추가…" ${ms('M8', '자막 메뉴')}>${icon(nosubs ? 'captions-off' : 'captions', 'sm')}${nosubs ? '자막 없음' : '한국어'}${icon('chevron-down', 'xs')}</span>
      <span class="btn small plain has-icon" title="현재 시간에 메모 ⇧⌘M" ${ms('M9', '시간 메모 단추')}>${icon('message-square-plus', 'sm')}시간 메모</span>`}
    </div>`;
    if (codec) {
      return `${head}<div class="video-stage">
        <div class="codec-notice" role="status" ${ms('M3', '재생 불가 안내(Finder에서 보기·기본 앱으로 열기)')}>
          <div class="glyph">${icon('video-off', 'xl')}</div>
          <h2>이&nbsp;동영상은 재생할 수 없습니다</h2>
          <p>Learn의 재생 엔진이 이&nbsp;파일의 형식을 지원하지 않습니다. MP4(H.264/AAC)&#8288;로 변환한 파일을 가져오면 재생할 수 있습니다. 원본&nbsp;파일은 그대로 보관됩니다.</p>
          <div class="file">seminar-0915.avi · 1.3 GB</div>
          <div class="actions"><div class="btn has-icon" title="⇧⌘R">${icon('folder-search')}Finder에서 보기</div><div class="btn has-icon">${icon('external-link')}기본 앱으로 열기</div></div>
        </div>
      </div>`;
    }
    if (nosubs) {
      return `${head}<div class="video-stage"><div class="video-frame">${titleSlide()}</div></div>${videoControls({ played: 0, time: '0:00', total: '47:32', memos: false, captions: false })}`;
    }
    return `${head}<div class="video-stage"><div class="video-frame">${lectureSlide()}<div class="subtitle" ${ms('M8', '자막 오버레이')}>그래서 이 단계에서 신호가 수백 배로 증폭됩니다.</div></div></div>${videoControls()}`;
  }

  function videoWindow({ codec = false } = {}) {
    if (codec) {
      return M.windowShell({
        tabs: [
          { title: '라이브러리', icon: 'library-big', home: true },
          { title: '수용체 탈감작 세미나 녹화', icon: 'clapperboard', active: true },
          { title: '분자생물학 6장 · 신호 전달', icon: 'file-text' },
        ],
        sidebar: '',
        main: videoMain({ codec: true }),
      });
    }
    const mode = state === 'nosubs' || state === 'nomatch' ? state : 'normal';
    const tabs =
      mode === 'nosubs'
        ? M.standardTabs('lec5', { more: [{ id: 'lec5', title: '강의 05 · 2차 전령', icon: 'clapperboard' }] })
        : M.standardTabs('video');
    return M.windowShell({ tabs, sidebar: videoSidebar(mode), main: videoMain({ mode }) });
  }

  // ── Command palette ────────────────────────────────────────────────────────
  function palette() {
    if (state === 'none') {
      return `<div class="scrim" style="opacity:0.55"></div>
      <div class="palette" role="dialog" aria-label="명령 팔레트" ${ms('M3', '명령 팔레트')}>
        <div class="p-input">${icon('search')}<span>효소 억제제</span><span class="caret"></span></div>
        <div class="p-empty" ${ms('M3', '팔레트 결과 없음')}>
          <div class="pe-title">‘효소 억제제’와 일치하는 자료·컬렉션·명령이 없습니다</div>
          <div class="pe-text">초성(ㅎㅅ)이나 영어 제목으로도 찾을 수 있습니다.</div>
        </div>
        <div class="p-list" role="listbox" style="padding-top:0">
          <div class="p-group">명령</div>
          <div class="p-item is-active" role="option">${icon('list-filter')}<span class="p-title ellipsis">라이브러리에서 ‘효소 억제제’ 검색</span><span class="p-meta">${kbd('⌘', 'F')}</span></div>
        </div>
        <div class="p-foot"><span class="row">${kbd('↩')}실행</span><span class="row">${kbd('esc')}닫기</span></div>
      </div>`;
    }
    const mark = (s) => esc(s).replace('신호', '<mark>신호</mark>');
    const item = (ic, title, meta, active) =>
      `<div class="p-item ${active ? 'is-active' : ''}" role="option" aria-selected="${!!active}">${icon(ic)}<span class="p-title ellipsis">${mark(title)}</span><span class="p-meta">${meta}</span></div>`;
    return `<div class="scrim" style="opacity:0.55"></div>
    <div class="palette" role="dialog" aria-label="명령 팔레트" ${ms('M3', '명령 팔레트')}>
      <div class="p-input">${icon('search')}<span>신호</span><span class="caret"></span><span class="p-scope">${kbd('esc')}</span></div>
      <div class="p-list" role="listbox">
        <div ${ms('M4', '팔레트 자료 결과')}>
          <div class="p-group">자료</div>
          ${item('file-text', '분자생물학 6장 · 신호 전달', `분자생물학 · 42쪽 ${kbd('↩')}`, true)}
          ${item('clapperboard', '강의 04 · 세포 신호', '분자생물학 · 18:20')}
          ${item('file-text', '신호 증폭의 정량 모델', '분자생물학')}
          ${item('file-text', '세포 신호 그림 모음', '분자생물학')}
        </div>
        <div ${ms('M5', '팔레트 컬렉션 결과')}>
          <div class="p-group">컬렉션</div>
          ${item('folder', '6장 · 신호 전달', '분자생물학 안 · 14개')}
        </div>
        <div class="p-group">명령</div>
        ${item('list-filter', '라이브러리에서 ‘신호’ 검색', kbd('⌘', 'F'))}
      </div>
      <div class="p-foot">
        <span class="row">${kbd('↑')}${kbd('↓')}이동</span>
        <span class="row">${kbd('↩')}열기</span>
        <span class="row">${kbd('⌘', '↩')}새 탭에서 열기</span>
        <span class="spacer"></span>
        <span class="row">초성 검색 지원 · ㅅㅎ → 신호</span>
      </div>
    </div>`;
  }

  // ── Settings window (⌘,) ──────────────────────────────────────────────────
  function themePreview(kind) {
    const L = { side: '#eef1f3', main: '#ffffff', line: '#d4d8dc' };
    const Dk = { side: '#1f2123', main: '#181a1b', line: '#3a3d40' };
    const pane = (c, clip = '') =>
      `<div class="pv" style="${clip}"><div class="pv-side" style="background:${c.side}"><i style="background:var(--accent);width:80%"></i><i style="background:${c.line};width:60%"></i><i style="background:${c.line};width:70%"></i></div>
       <div class="pv-main" style="background:${c.main}"><i style="background:${c.line};width:90%"></i><i style="background:${c.line};width:70%"></i><i style="background:${c.line};width:80%"></i><i style="background:${c.line};width:50%"></i></div></div>`;
    const body = kind === 'system' ? pane(L, 'clip-path:inset(0 50% 0 0)') + pane(Dk, 'clip-path:inset(0 0 0 50%)') : pane(kind === 'dark' ? Dk : L);
    return `<div class="preview">${body}<span class="lights"><b></b><b></b><b></b></span></div>`;
  }

  /** A separate macOS window (Zotero/Things/Raycast convention): no Done/×, changes apply at once. */
  function settingsWindow() {
    return `<div class="os-window settings-window" role="dialog" aria-label="설정" ${ms('M3', '설정 창')}>
      <div class="os-titlebar"><div class="traffic-lights" aria-hidden="true"><i class="close"></i><i class="min"></i><i class="zoom"></i></div>설정</div>
      <div class="s-body">
        <div>
          <div class="group-label">외관</div>
          <div class="form-group">
            <div class="form-row stacked">
              <span class="fr-label">테마</span>
              <div class="theme-tiles">
                <div class="theme-tile is-on">${themePreview('system')}<span>시스템 설정</span></div>
                <div class="theme-tile">${themePreview('light')}<span>라이트</span></div>
                <div class="theme-tile">${themePreview('dark')}<span>다크</span></div>
              </div>
            </div>
            <div class="form-row">
              <span class="fr-label">밀도<span class="hint">목록과 표의 행 높이 · 24 / 28 / 32</span></span>
              <div class="segmented"><span class="seg">촘촘하게</span><span class="seg is-on">보통</span><span class="seg">여유 있게</span></div>
            </div>
            <div class="form-row">
              <span class="fr-label">글자 크기<span class="hint">목록과 패널의 글자 크기 · 12 / 13 / 14 / 15pt</span></span>
              <div class="segmented" role="radiogroup" aria-label="글자 크기"><span class="seg" title="12pt">작게</span><span class="seg is-on" title="13pt">기본</span><span class="seg" title="14pt">크게</span><span class="seg" title="15pt">아주 크게</span></div>
            </div>
          </div>
        </div>
        <div>
          <div class="group-label">라이브러리</div>
          <div class="form-group">
            <div class="form-row stacked">
              <span class="fr-label">위치<span class="hint">자료 사본과 데이터베이스가 있는 폴더입니다. 다른&nbsp;폴더를 고르면 Learn을 다시 시작하고 그&nbsp;폴더의 라이브러리를 엽니다.</span></span>
              <div class="path-box" title="/Users/seojin/Library/Application Support/Learn/Library">${icon('folder', 'sm')}<span class="ellipsis">~/Library/Application Support/Learn/Library</span></div>
              <div class="row gap-8"><div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div><div class="btn">다른 폴더 선택…</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Sheets and toasts ──────────────────────────────────────────────────────
  function importToast({ waiting = false } = {}) {
    return `<div class="toasts" role="status">
      <div class="toast" ${ms('M6', '가져오기 진행 토스트')}>
        ${waiting ? `<span class="c-secondary">${icon('circle-pause')}</span>` : `<span class="spinner" aria-hidden="true"></span>`}
        <div><div class="t-title">${waiting ? '확인을 기다리는 중' : '가져오는 중'} · <span class="num">7 / 12</span></div><div class="t-body ellipsis">${waiting ? 'molbio_ch06_signaling.pdf' : '강의 08 · 효소 조절.mp4'}</div></div>
        <div class="t-actions"><div class="btn small">취소</div></div>
        <div class="t-progress"><span class="progress wide"><i style="width:58%"></i></span><span class="pct t-footnote c-secondary">58%</span></div>
      </div>
    </div>`;
  }

  function duplicateSheet() {
    return `<div class="dialog" role="alertdialog" aria-label="중복 파일" ${ms('M3', '중복 확인 시트')}>
      <div class="d-body">
        <div class="d-title"><span class="badge-icon">${icon('copy')}</span><div><h2>이미 라이브러리에 있는 파일입니다</h2></div></div>
        <p class="d-text"><b>molbio_ch06_signaling.pdf</b>는 아래 자료와 내용이 완전히 같습니다. 어느&nbsp;쪽을 골라도 원본&nbsp;파일은 지우지 않습니다.</p>
        <div class="card item-card"><span class="thumb">${icon('file-text')}</span>
          <div style="min-width:0"><div class="t-headline ellipsis">분자생물학 6장 · 신호 전달</div><div class="t-footnote c-secondary ellipsis">분자생물학 · 4.2 MB · 2026. 10. 20. 추가</div></div></div>
        <label class="checkbox t-footnote" ${ms('M6', '남은 중복에 같은 선택')}><span class="box is-on">${icon('check')}</span>남은 중복 파일 2개에도 같은 선택 적용</label>
      </div>
      <div class="d-foot">
        <div class="btn plain accent leading">기존 자료 열기</div>
        <span class="spacer"></span>
        <div class="btn">새 자료로 추가</div>
        <div class="btn primary" title="↩">건너뛰기</div>
      </div>
    </div>`;
  }

  function backupSheet() {
    return `<div class="dialog" role="dialog" aria-label="백업 완료" ${ms('M6', '백업 결과 시트')}>
      <div class="d-body">
        <div class="d-title"><span class="badge-icon success">${icon('circle-check')}</span><div><h2>백업을 만들었습니다</h2><div class="t-footnote c-secondary" style="margin-top:2px">2026. 10. 20. 오후 9:41 · 38초 걸림</div></div></div>
        <div class="card" style="padding:12px 16px">
          <dl class="kv" style="grid-template-columns:max-content minmax(0,1fr)">
            <dt>자료</dt><dd><span class="num">128</span>개 · 필기와 태그 포함</dd>
            <dt>파일</dt><dd><span class="num">121</span>개 · 2.4 GB · 손상 없음</dd>
            <dt>위치</dt><dd class="ellipsis" style="font:var(--type-mono);color:var(--text-secondary)" title="/Users/seojin/Documents/Learn 백업/2026-10-20.learnbackup">~/Documents/Learn 백업/2026-10-20.learnbackup</dd>
          </dl>
        </div>
        <div class="row gap-8 t-footnote c-secondary" style="align-items:flex-start">${icon('info', 'sm')}<span class="hint" style="display:block">외부 연결 자료 7개는 파일 없이 위치만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.</span></div>
      </div>
      <div class="d-foot"><div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div><span class="spacer"></span><div class="btn primary" title="↩">완료</div></div>
    </div>`;
  }

  function recoverySheet() {
    // Meta line: footnote with tabular figures; paths only in mono (design-spec 4, 6).
    const ci = (ic, cls, title, text, meta, metaTitle, action, metaMono = false) =>
      `<div class="check-item"><span class="status-dot ${cls}">${icon(ic)}</span><div><div class="ci-title">${title}</div><div class="ci-text">${text}</div>${meta ? `<div class="ci-meta ellipsis ${metaMono ? 'mono' : ''}" title="${metaTitle}">${meta}</div>` : ''}</div><div class="ci-action">${action}</div></div>`;
    return `<div class="dialog wide" role="dialog" aria-label="라이브러리 점검" ${ms('M6', '라이브러리 점검 시트')}>
      <div class="d-body" style="padding-bottom:12px">
        <div class="d-title" style="align-items:flex-start"><span class="badge-icon warning">${icon('stethoscope')}</span><div><h2 style="margin-top:5px">라이브러리 점검</h2>
          <p class="d-text" style="margin-top:4px">지난번에 Learn이 정상적으로 종료되지 않아 라이브러리를 확인했습니다. 자동으로&nbsp;지운&nbsp;것은 없습니다.</p></div></div>
      </div>
      <div class="card checklist" style="margin:0 20px">
        ${ci('circle-check', 'c-success', '자료와 필기', '모두 그대로입니다. 자료 128개와 필기를 확인했습니다.', '', '', '')}
        ${ci('triangle-alert', 'c-warning', '가져오다 멈춘 임시 파일 2개', '라이브러리에는 추가되지 않았습니다. 정리하면 디스크&nbsp;공간을 돌려받습니다.', '412 MB', '', '<div class="btn small">임시 파일 정리</div>')}
        ${ci('triangle-alert', 'c-warning', '원본을 찾을 수 없는 외부 연결 1개', 'Calcium Signaling Revisited — 파일을 옮겼다면 새&nbsp;위치를 지정하세요.', '~/Downloads/papers/calcium-signaling.pdf', '/Users/seojin/Downloads/papers/calcium-signaling.pdf', '<div class="btn small">다시 연결…</div>', true)}
        ${ci('info', 'c-secondary', '따로 보관한 손상된 사본 1개', '내용이 손상되어 라이브러리에서 뺀 사본입니다. 확인한 뒤 직접 지울 수 있습니다.', '분자생물학 6장 · 신호 전달 · 4.2 MB', '', '<div class="btn small">Finder에서 보기</div>')}
      </div>
      <div class="d-foot" style="padding-top:16px"><span class="t-footnote c-tertiary">언제든 메뉴 막대의 파일 › 라이브러리 점검에서 다시 할 수 있습니다.</span><span class="spacer"></span><div class="btn primary" title="↩">완료</div></div>
    </div>`;
  }

  // ── Component and token board ──────────────────────────────────────────────
  function componentsBoard() {
    const part = ['2', '3', '4', '5'].includes(params.get('part')) ? Number(params.get('part')) : 1;
    if (part === 4) return tutorBoard();
    if (part === 5) return tutorBoardLists();
    const row = (label, html) => `<div class="state-row"><span class="lbl">${label}</span>${html}</div>`;
    const header = (title, sub) => `<header><h1>${title}</h1><p>${sub}</p></header>`;
    if (part === 1) {
      const btns = (cls, label, ic) =>
        ['', 'is-hover', 'is-pressed', 'is-focus', 'is-disabled']
          .map((st) => `<span class="btn ${cls} ${st} ${ic ? 'has-icon' : ''}">${ic ? icon(ic) : ''}${label}</span>`)
          .join('');
      return `<div class="board">${header('컴포넌트 상태 1 — 버튼·입력·목록', '기본 · 호버 · 누름 · 키보드 포커스 · 비활성. 모든 값은 tokens.css. 포커스 링은 2px --focus, 1px 띄움(행·탭은 안쪽).')}
        <div class="board-grid">
          <section class="panel" style="grid-column:span 2">
            <h3>버튼</h3>
            ${row('기본', btns('primary', '열기'))}
            ${row('보조', btns('', '가져오기', 'plus'))}
            ${row('평면', btns('plain', '건너뛰기'))}
            ${row('아이콘', ['', 'is-hover', 'is-pressed', 'is-on', 'is-focus', 'is-disabled'].map((st) => `<span class="icon-btn ${st}" title="${st || '기본'}">${icon('panel-left')}</span>`).join('') + `<span class="t-caption c-tertiary">기본 · 호버 · 누름 · 켜짐(토글) · 포커스 · 비활성</span>`)}
            ${row('작게', `<span class="btn small">취소</span><span class="btn small primary">다시 연결…</span><span class="btn small plain has-icon has-menu">${icon('captions', 'sm')}한국어${icon('chevron-down', 'xs')}</span>`)}
          </section>
          <section class="panel">
            <h3>웹 팝업 메뉴(정렬 단추)</h3>
            <div class="menu static-menu" role="menu">
              <div class="mhead">정렬 기준</div>
              ${mi('추가일', { check: true })}
              ${mi('제목', { active: true })}
              ${mi('진행', { disabled: true, title: '자료를 한 번 이상 열어야 정렬할 수 있습니다' })}
              <div class="msep"></div>
              ${mi('오름차순')}${mi('내림차순', { check: true })}
            </div>
            <div class="t-caption c-tertiary">컨텍스트 메뉴와 메뉴 막대는 네이티브(ADR-0005). 비활성 이유는 툴팁.</div>
          </section>
          <section class="panel">
            <h3>입력</h3>
            ${row('기본', `<div class="field" style="width:220px">${icon('search', 'sm')}<span class="placeholder">제목, 저자, 태그 검색</span></div>`)}
            ${row('포커스', `<div class="field is-focus" style="width:220px">${icon('search', 'sm')}<span class="value">신호</span><span class="caret"></span><span class="spacer"></span>${icon('circle-x', 'sm')}</div>`)}
            ${row('비활성', `<div class="field" style="width:220px;opacity:.5">${icon('search', 'sm')}<span class="placeholder">찾기 · 문서를 여는 중</span></div>`)}
            ${row('작게', `<div class="field small" style="width:160px">${icon('search', 'sm')}<span class="placeholder">태그 필터</span></div><div class="page-field"><div class="field">42</div><span class="num">/ 68</span></div>`)}
            ${row('세그먼트', `<div class="segmented"><span class="seg">촘촘하게</span><span class="seg is-on">보통</span><span class="seg">여유 있게</span></div>`)}
            ${row('선택', `<label class="checkbox"><span class="box"></span>끔</label><label class="checkbox"><span class="box is-on">${icon('check')}</span>켬</label><span class="switch"></span><span class="switch is-on"></span>`)}
          </section>
          <section class="panel on-sidebar">
            <h3>사이드바 행</h3>
            ${navRow({ label: '기본', ic: 'folder', count: 31 })}
            ${navRow({ label: '호버', ic: 'folder', count: 22, cls: 'is-hover' })}
            ${navRow({ label: '선택 · 포커스 없음', ic: 'folder-open', count: 48, selected: true })}
            ${navRow({ label: '선택 · 포커스', ic: 'folder', count: 14, selected: true, focused: true })}
            ${navRow({ label: '키보드 커서(선택 안 됨)', ic: 'folder', count: 6, cursor: true })}
            ${navRow({ label: '드롭 대상 (⌘ 이동)', ic: 'folder', count: 9, cls: 'is-drop-target' })}
          </section>
          <section class="panel" style="padding-left:8px;padding-right:8px">
            <h3 style="padding-left:8px">표 행</h3>
            <div class="table" style="--cols:minmax(0,1fr) 48px 96px"><div class="table-body" style="padding-top:0">
              ${[
                ['기본', {}, 35],
                ['호버', { hover: true }, 100],
                ['선택 · 포커스 없음', { selected: true }, 35],
                ['선택 · 포커스', { selected: true, focused: true }, 62],
                ['선택 · 포커스 · 커서', { selected: true, focused: true, cursor: true }, 18],
                ['커서(선택 안 됨)', { cursor: true }, null],
              ]
                .map(([label, st, p]) =>
                  `<div class="table-row ${st.hover ? 'is-hover' : ''} ${st.selected ? 'is-selected' : ''} ${st.focused ? 'is-focused' : ''} ${st.cursor ? 'is-cursor' : ''}" ${st.hover || st.selected ? '' : 'style="background:transparent"'}><div class="td">${icon('file-text')}<span class="title ellipsis">${label}</span></div><div class="td num">2024</div><div class="td">${progressCell(p)}</div></div>`,
                )
                .join('')}
            </div></div>
          </section>
        </div>
        <div class="board-grid">
          <section class="panel">
            <h3>칩 · 진행 · 키 · 의미</h3>
            <div class="tag-cloud">${[1, 2, 4].map((n) => tagChip(n)).join('')}<span class="chip">수용체</span><span class="chip is-on">시험 범위</span><span class="chip is-dim">회귀분석</span><span class="chip add">${icon('plus', 'sm')}태그 추가</span></div>
            ${row('진행', `<span class="progress" style="width:120px"><i style="width:62%"></i></span><span class="spinner"></span>${progressCell(100)}`)}
            ${row('키', `${kbd('⌘', 'K')}${kbd('⇧', '⌘', 'N')}${kbd('⌥')}${kbd('esc')}<span class="shortcut">⌃⌘S</span>`)}
            ${row('의미', `<span class="inline-flag c-success">${icon('circle-check', 'sm')}완료</span><span class="inline-flag c-warning">${icon('triangle-alert', 'sm')}파일 없음</span><span class="inline-flag c-danger">${icon('circle-alert', 'sm')}저장 실패</span>`)}
          </section>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="toast static"><span class="spinner"></span><div><div class="t-title">가져오는 중 · <span class="num">7 / 12</span></div><div class="t-body ellipsis">강의 08 · 효소 조절.mp4</div></div><div class="t-actions"><div class="btn small">취소</div></div><div class="t-progress"><span class="progress wide"><i style="width:58%"></i></span><span class="pct t-footnote c-secondary">58%</span></div></div>
            <div class="toast static"><span class="c-success">${icon('circle-check')}</span><div><div class="t-title">12개 중 11개를 가져왔습니다</div><div class="t-body">1개는 이미 있는 자료라 건너뛰었습니다.</div></div><div class="t-actions"><div class="btn small plain link">보기</div></div></div>
          </div>
          <div class="toast static"><span class="c-danger">${icon('circle-alert')}</span><div><div class="t-title">필기를 저장하지 못했습니다</div><div class="t-body">디스크&nbsp;공간이 부족합니다. 공간을 확보한 뒤 다시 시도하세요.</div></div><div class="t-actions"><div class="btn small">다시 시도</div></div></div>
        </div>
      </div>`;
    }
    if (part === 3) {
      const tabRow = (cls, label, closeCls = '') =>
        `<div class="tab ${cls}" style="flex:none;width:172px">${icon('file-text')}<span class="title ellipsis">${label}</span><span class="close ${closeCls}">${icon('x', 'sm')}</span></div>`;
      return `<div class="board">${header('컴포넌트 상태 2 — 탭·컨트롤·리더', '탭, 세그먼트, 선택 컨트롤, 칩, 실행기, 스크러버, 썸네일의 호버·포커스·누름·비활성·끌기 상태.')}
        <div class="board-grid">
          <section class="panel" style="grid-column:span 2;background:var(--bg-window)">
            <h3>탭(제목 막대)</h3>
            <div class="state-row" style="gap:16px">
              <div class="state-col">${tabRow('', '비활성')}<span class="t-caption c-tertiary">비활성</span></div>
              <div class="state-col">${tabRow('is-hover', '호버')}<span class="t-caption c-tertiary">호버(닫기 보임)</span></div>
              <div class="state-col">${tabRow('is-active', '활성')}<span class="t-caption c-tertiary">활성</span></div>
            </div>
            <div class="state-row" style="gap:16px">
              <div class="state-col">${tabRow('is-active is-focus', '키보드 포커스')}<span class="t-caption c-tertiary">포커스(안쪽 링)</span></div>
              <div class="state-col">${tabRow('is-hover', '닫기 호버', 'is-hover')}<span class="t-caption c-tertiary">닫기 단추 호버</span></div>
              <div class="state-col">${tabRow('is-dragging', '끌기 중')}<span class="t-caption c-tertiary">끌기 중(순서 바꾸기)</span></div>
            </div>
          </section>
          <section class="panel">
            <h3>실행기(⌘K)</h3>
            ${row('기본', `<div class="field launcher" style="width:220px">${icon('search', 'sm')}<span class="placeholder">검색 및 명령</span><span class="spacer"></span>${kbd('⌘', 'K')}</div>`)}
            ${row('포커스', `<div class="field launcher is-focus" style="width:220px">${icon('search', 'sm')}<span class="placeholder">검색 및 명령</span><span class="spacer"></span>${kbd('⌘', 'K')}</div>`)}
            <div class="t-caption c-tertiary">누르거나 ⌘K → 팔레트가 열리고 포커스는 팔레트 입력으로.</div>
          </section>
          <section class="panel">
            <h3>세그먼트 · 선택 컨트롤</h3>
            ${row('포커스', `<div class="segmented is-focus"><span class="seg">썸네일</span><span class="seg is-on">목차</span><span class="seg">필기</span></div>`)}
            ${row('비활성', `<div class="segmented is-disabled"><span class="seg is-on">대본</span><span class="seg">시간 메모</span></div>`)}
            ${row('체크박스', `<label class="checkbox is-focus"><span class="box is-on">${icon('check')}</span>포커스</label><label class="checkbox is-disabled"><span class="box"></span>비활성</label>`)}
            ${row('스위치', `<span class="switch is-on is-focus"></span><span class="t-caption c-tertiary">포커스</span><span class="switch is-disabled"></span><span class="t-caption c-tertiary">비활성</span>`)}
          </section>
          <section class="panel">
            <h3>칩</h3>
            ${row('기본', `<span class="chip">수용체</span>`)}
            ${row('호버', `<span class="chip is-hover">수용체<span class="x" title="태그 떼기">${icon('x', 'xs')}</span></span>`)}
            ${row('포커스', `<span class="chip is-focus">수용체<span class="x">${icon('x', 'xs')}</span></span><span class="t-caption c-tertiary">⌫로 떼기</span>`)}
            ${row('선택(필터)', `<span class="chip is-on">시험 범위</span>`)}
          </section>
          <section class="panel on-sidebar">
            <h3>썸네일</h3>
            <div class="state-row" style="gap:20px;align-items:flex-start">
              ${[
                ['', '기본', 40],
                ['is-hover', '호버', 41],
                ['is-current', '현재 쪽', 42],
                ['is-focus', '포커스', 43],
                ['is-current is-focus', '현재 쪽 + 포커스', 42],
              ]
                .map(([c, l, n]) => `<div class="state-col"><div class="thumb ${c}" style="zoom:.62"><div class="thumb-page"><div class="pdf-page">${pageBody(n, { find: false })}</div></div><span class="lbl">${n}</span></div><span class="t-caption c-tertiary">${l}</span></div>`)
                .join('')}
            </div>
          </section>
          <section class="panel" style="grid-column:span 3">
            <h3>스크러버</h3>
            ${row('기본', `<div class="scrubber" style="width:420px"><div class="track"><span class="buffered" style="width:58%"></span><span class="played" style="width:35%"></span><span class="knob" style="left:35%"></span></div></div>`)}
            ${row('호버', `<div class="scrubber is-hover" style="width:420px;margin-top:20px"><div class="track"><span class="buffered" style="width:58%"></span><span class="played" style="width:35%"></span><span class="hover-pos" style="left:52%"></span><span class="knob" style="left:35%"></span></div><span class="hover-time" style="left:52%">27:08</span></div>`)}
            ${row('끌기', `<div class="scrubber is-dragging" style="width:420px;margin-top:20px"><div class="track"><span class="buffered" style="width:58%"></span><span class="played" style="width:44%"></span><span class="knob" style="left:44%"></span></div><span class="hover-time" style="left:44%">22:57</span></div>`)}
          </section>
        </div>
      </div>`;
    }
    const sw = (name, note = '') => `<div class="swatch"><i style="background:var(--${name})"></i><span>${note || name}</span><code>--${name}</code></div>`;
    const tsw = (n) => `<div class="swatch"><i style="background:var(--tag-${n})"></i><span>${n} · ${['노랑', '빨강', '초록', '파랑', '보라', '자홍', '주황', '회색'][n - 1]}</span><code>--tag-${n}</code></div>`;
    const type = (role, sample) =>
      `<div class="type-row"><span class="meta">${role}<br>${getComputedStyle(document.documentElement).getPropertyValue(`--text-${role}-size`).trim()} / ${getComputedStyle(document.documentElement).getPropertyValue(`--text-${role}-line`).trim()}</span><span class="t-${role}" style="font:var(--type-${role})">${sample}</span></div>`;
    return `<div class="board">${header('토큰', '색은 OKLCH + light-dark(). 이 화면은 현재 테마의 값을 그대로 보여 줍니다. 대비는 tokens.test.ts가 검사합니다.')}
      <div class="board-grid" style="grid-template-columns:1.2fr 1fr 1fr">
        <section class="panel"><h3>면</h3><div class="swatches">
          ${sw('bg-window', '창 크롬')}${sw('bg-sidebar', '사이드바')}${sw('bg-content', '내용')}${sw('bg-content-alt', '줄무늬')}
          ${sw('bg-raised', '메뉴·대화상자')}${sw('bg-sunken', 'PDF 바탕')}${sw('fill-hover', '호버')}${sw('fill-selected', '선택(비포커스)')}
          ${sw('separator', '구분선')}${sw('border', '테두리')}${sw('border-strong', '강한 테두리')}${sw('video-stage', '영상 바탕')}
        </div></section>
        <section class="panel"><h3>글자 · 강조</h3><div class="swatches" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${sw('text-primary', '본문')}${sw('text-secondary', '보조')}${sw('text-tertiary', '3차')}
          ${sw('accent', '강조 채움')}${sw('accent-text', '강조 글자')}${sw('focus', '포커스 링')}
          ${sw('danger', '위험')}${sw('warning', '주의')}${sw('success', '성공')}
        </div></section>
        <section class="panel"><h3>태그 · 필기 8색</h3><div class="swatches">${[1, 2, 3, 4, 5, 6, 7, 8].map(tsw).join('')}</div></section>
      </div>
      <div class="board-grid" style="grid-template-columns:1.2fr 1fr">
        <section class="panel"><h3>글자 역할</h3>
          ${type('title1', '라이브러리가 비어 있습니다')}
          ${type('title2', '이미 라이브러리에 있는 파일입니다')}
          ${type('title3', '분자생물학 6장 · 신호 전달')}
          ${type('callout', 'PDF나 동영상을 이 창에 끌어다 놓으세요.')}
          ${type('body', '하나의 활성 수용체는 수백 개의 G&nbsp;단백질을 활성화한다.')}
          ${type('headline', '가져오는 중 · 7 / 12')}
          ${type('paragraph', '외부 연결 자료 7개는 파일 없이 위치만 기록했습니다.')}
          ${type('footnote', '42 / 68쪽에서 멈춤 · 오늘 오전 9:24')}
          ${type('caption', '라이브러리 · 컬렉션 · 태그')}
          ${type('mono', '~/Library/Application Support/Learn')}
        </section>
        <section class="panel"><h3>간격 · 반경 · 그림자</h3>
          <div class="state-row">${[2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48].map((n) => `<span title="${n}" style="display:inline-block;width:${n}px;height:24px;background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)"></span>`).join('')}</div>
          <div class="state-row t-caption c-tertiary">2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 px (2·6은 아이콘-글자 간격만)</div>
          <div class="state-row" style="gap:16px">${['xs', 'sm', 'md', 'lg', 'xl'].map((r) => `<span style="display:grid;place-items:center;width:52px;height:40px;border-radius:var(--radius-${r});background:var(--fill-pressed);font:var(--type-caption);color:var(--text-secondary)">${r}</span>`).join('')}</div>
          <div class="state-row" style="gap:20px;padding:8px 4px 4px">${['e0', 'e1', 'e2'].map((e) => `<span style="display:grid;place-items:center;width:96px;height:56px;border-radius:var(--radius-lg);background:var(--bg-raised);box-shadow:var(--shadow-${e});font:var(--type-caption);color:var(--text-secondary)">${e}</span>`).join('')}</div>
          <div class="state-row">${row('행 높이', `<span class="t-footnote c-secondary num">24 촘촘하게 · 28 보통 · 32 여유 있게</span>`)}</div>
          <div class="state-row">${row('아이콘', `${icon('library-big')}${icon('folder')}${icon('file-text')}${icon('clapperboard')}${icon('search')}${icon('panel-left')}${icon('highlighter')}<span class="t-footnote c-secondary">lucide 16px · stroke 1.5</span>`)}</div>
        </section>
      </div>
    </div>`;
  }

  // ── Tutor (T1 mockup) — tutor.html ────────────────────────────────────────
  // The tutor is the right slot's second mode [정보 | 튜터] (design-spec 2.5, ADR-0010 §7). The
  // query parameters are listed at the top of tutor.html. Defaults are the owner's decisions of
  // 2026-10-27 (`cite` is provisional); every alternative is one query parameter away.
  const T = D.tutor;
  const pick = (name, allowed, fallback) => {
    const v = params.get(name);
    return v && allowed.includes(v) ? v : fallback;
  };
  const tu = {
    state: Number(pick('state', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], '5')),
    width: Number(pick('width', ['320', '340', '380', '440'], '380')),
    msg: pick('msg', ['doc', 'bubble'], 'bubble'),
    cite: pick('cite', ['page', 'p', 'icon'], 'page'),
    consent: pick('consent', ['card', 'sheet'], 'card'),
    sessions: pick('sessions', ['sidebar', 'panel'], 'sidebar'),
    mode: pick('mode', ['tutor', 'info'], 'tutor'),
    agents: pick('agents', ['list', 'none', 'searching', 'blocked'], 'list'),
    fail: pick('fail', ['offline', 'agent', 'login'], 'offline'),
    fold: pick('fold', ['collapsed', 'open', '960'], 'collapsed'),
    view: pick('view', ['reader', 'library'], 'reader'),
    backend: pick('backend', ['agent', 'fake'], 'agent'),
    later: params.get('later') === '1',
    empty: params.get('empty') === '1',
    menu: pick('menu', ['agent'], null),
    sheet: pick('sheet', ['delete'], null),
    top: params.get('scroll') === 'top',
    page: pick('page', ['original', 'sepia', 'dark'], null),
  };
  /** The right slot's toggle has one name whatever the mode (design-spec 7.4 toggle names). */
  const SLOT_TOGGLE = (open) => `${open ? '오른쪽 패널 가리기' : '오른쪽 패널 보기'} ⌥⌘I`;
  /**
   * Reader minimum width = the reader toolbar's min-content width, measured live in the app (so the text
   * size and the system font count). Mockup measurement (Linux, Pretendard, 13–15 pt) with the slot toggle:
   * T1 (no annotation group) 429–438 → 440; M9 (with it) 626–635 → 640. See tutor-decisions.md.
   */
  const READER_MIN = { t1: 440, m9: 640 };

  /** Citation label in one of the three notations under decision (§4 "인용 칩 표기"). */
  const citeLabel = (fmt, page) => (fmt === 'p' ? `p.&nbsp;${page}` : fmt === 'icon' ? `${icon('file-text', 'xs')}${page}` : `${page}쪽`);
  /** Citation chip: page precision (Learn verifies pages, ADR-0010 §3). Pressing it moves the reader there. */
  const cite = (page, { st = '', tag = false, title = null, fmt = tu.cite } = {}) =>
    `<span class="cite ${st}" role="link" title="${title ?? `${page}쪽으로 이동`}" ${tag ? ms('T1', '인용 칩(누르면 리더가 그 쪽으로)') : ''}>${citeLabel(fmt, page)}</span>`;
  /** A citation stays on the line of the word it follows (an agent's answer is rendered this way too). */
  const tail = (word, chip) => `<span class="cite-tail">${word}${chip}</span>`;
  /** Not verified: a status with a tooltip, not a button (it has no place to go). */
  const unverified = (claimed, { tag = false, st = '' } = {}) =>
    `<span class="cite is-unverified ${st}" tabindex="0" title="확인되지 않은 인용 · 튜터가 ${claimed}쪽을 가리켰지만 이번 답에서 그 쪽을 읽지 않았습니다" ${tag ? ms('T1', '검증되지 않은 인용(출처 없음)') : ''}>${icon('circle-help', 'xs')}출처 없음</span>`;
  /** Tool chip: what Learn's read-only tools returned in this turn (ADR-0010 §2). A status, not a button. */
  const tool = (ic, label, { st = '', title = '' } = {}) =>
    `<span class="tool ${st}" tabindex="0" title="${title}">${st === 'is-running' ? '<span class="spinner sm"></span>' : icon(ic, 'sm')}${label}</span>`;

  /** Sent-scope line under each request: counts, expandable to the list of what went to the agent. */
  function scopeLine([doc, ex, mem], { open = false, list = null, st = '' } = {}) {
    const line = `<div class="tu-scope ${open ? 'is-open' : ''} ${st}" role="button" aria-expanded="${open}" title="이 질문과 함께 에이전트에 보낸 것 · 누르면 목록이 열립니다">${icon('send', 'sm')}<span class="num">자료&nbsp;${doc} · 발췌&nbsp;${ex} · 기억&nbsp;${mem}</span>${icon(open ? 'chevron-up' : 'chevron-down', 'xs')}</div>`;
    return open ? `${line}<dl class="tu-scope-list">${list.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : line;
  }
  const SCOPE1_LIST = [
    ['자료', `${esc(T.item)}(이름)`],
    ['대화', '없음(첫 질문)'],
    ['발췌', '42쪽 · 선택한 구간<br>41–42쪽 · 튜터가 읽은 본문'],
    ['기억', '없음'],
  ];

  const Q1 = '‘각 단계 배율의 곱’이 무슨 뜻인지 예를 들어 설명해 주세요.';
  const Q2 = '그럼 신호를 끄는 반응이 없으면 배율이 끝없이 커지나요?';
  const Q3 = '방금 설명을 노트로 정리하고, 확인 문제도 하나 내 주세요.';

  /** `tag` puts the milestone on the quote's citation chip and on the scope row (where the ?ms=1 badge covers nothing). */
  const userMsg = ({ text, quote = false, scope = null, open = false, tag = false }) => `
    <div class="tu-msg user">
      <div class="bubble">${quote ? `<div class="tu-quote"><span class="q">${esc(T.selection.text)}</span>${cite(T.selection.page, { title: '42쪽으로 이동 · 질문에 붙인 구간이 있는 쪽', tag })}</div>` : ''}<p>${esc(text)}</p></div>
      ${scope ? `<div class="tu-scope-row" ${tag ? ms('T1', '보낸 범위 줄(자료·발췌·기억)') : ''}>${scopeLine(scope, { open, list: SCOPE1_LIST })}</div>` : ''}
    </div>`;
  const tutorMsg = ({ tools = [], body, foot = '', tagTools = false, cls = '' }) => `
    <div class="tu-msg tutor ${cls}">
      ${tools.length ? `<div class="tu-tools" ${tagTools ? ms('T1', '도구 칩(튜터가 읽은 것)') : ''}>${tools.join('')}</div>` : ''}
      <div class="body">${body}</div>
      ${foot}
    </div>`;
  const answerFoot = (tag = false) =>
    `<div class="tu-foot-row"><span class="icon-btn sm" title="답 복사" ${tag ? ms('T1', '답 복사') : ''}>${icon('copy', 'sm')}</span></div>`;

  /** Answer 1 — grounded in pp. 41–42 (views.js pageBody). `current`: index of the chip the reader is showing. */
  function answer1({ tag = false, current = -1, foot = true } = {}) {
    const c = (p, k) => cite(p, { st: current === k ? 'is-current' : '' });
    return tutorMsg({
      tools: [
        tool('text-select', '선택한 구간 확인', { title: '질문에 붙인 구간과 위치를 확인했습니다' }),
        tool('book-open-text', '41–42쪽 읽음', { title: '41–42쪽 본문을 읽었습니다' }),
      ],
      body: `<p>곱한다는 것은 앞 단계에서 켜진 분자 하나하나가 다음 단계의 분자를 여러 개씩 켠다는 뜻입니다. 그래서 배율은 단계마다 더해지지 않고 ${tail('곱해집니다.', c(42, 0))}</p>
        <ol><li>활성 수용체 하나가 G 단백질을 약 100개 켭니다.</li><li>고리화효소 하나가 cAMP를 약 100개 만듭니다.</li><li>두 단계만 곱해도 100 × 100 = 10,000, 곧 만 배가 ${tail('됩니다.', c(42, 1))}</li></ol>
        <p>경로의 각 단계를 신호를 키우는 자리로 설명한 41쪽도 같은 ${tail('뜻입니다.', c(41, 2))}</p>`,
      foot: foot ? answerFoot(tag) : '',
      tagTools: tag,
    });
  }
  const A2_LEAD = '끄는 반응이 전혀 없는 경우는 드뭅니다. G 단백질은 GTP를 가수분해해 스스로 꺼지기 때문에, 신호의 세기는 각 분자가 활성 상태로 머무는 시간에 달려';
  const a2lead = () => `${A2_LEAD} ${tail('있습니다.', cite(42))}`;
  function answer2({ done = false, tag = false } = {}) {
    if (!done) {
      return tutorMsg({
        cls: 'is-streaming',
        tools: [tool('book-open-text', '42쪽 읽음', { title: '42쪽 본문을 읽었습니다' })],
        body: `<p>${a2lead()} 가수분해가 느릴수록 한 번의 자극이<span class="stream-caret"></span></p>`,
      });
    }
    const notice = `<div class="tu-notice" role="status" ${ms('T1', '원문 근거로 다시 묻기')}>${icon('circle-help', 'c-warning')}<div class="nt">인용 1개를 확인하지 못했습니다</div>
      <div class="nt-text">튜터가 이번 답에서 읽지 않은 쪽을 가리켰습니다. 원문 근거로 다시 물으면 튜터가 먼저 그&nbsp;쪽을 읽고 답하게 합니다. 이번에도 읽지 않은 쪽을 가리키면 다시 표시합니다.</div>
      <div class="nt-actions"><span class="btn small">원문 근거로 다시 묻기</span></div></div>`;
    return tutorMsg({
      tools: [tool('book-open-text', '42쪽 읽음', { title: '42쪽 본문을 읽었습니다' })],
      body: `<p>${a2lead()} 가수분해가 느릴수록 한 번의 자극이 더 오래 이어져 배율이 커지지만, 끝없이 커지지는 ${tail('않습니다.', cite(42))} 여러 경로가 같은 표적을 두고 겨루는 교차 대화도 배율을 ${tail('줄입니다.', unverified(57, { tag }))}</p>`,
      foot: answerFoot() + notice,
    });
  }
  /** Session head: the date (and, in the library, the item). The name is drawn only once the user renames the session — until then it is the first question, right below. */
  const sessionTitle = ({ item = false, renamed = null } = {}) =>
    `<div class="tu-title">${renamed ? `<span class="t ellipsis" title="${esc(renamed)}">${esc(renamed)}</span>` : ''}<span class="m">${item ? `${icon('file-text', 'sm')}<span class="ellipsis">${esc(T.item)}</span> · ` : ''}<span style="flex:none">${T.started}</span></span></div>`;
  /** The session's name under the head once the conversation is scrolled away from its title (mockup.js scrollToEnd). */
  const sticky = () => `<div class="tu-sticky" hidden><span class="ellipsis">${esc(T.session)}</span></div>`;
  const thread = (inner, { end = !tu.top } = {}) =>
    `${sticky()}<div class="tu-scroll ${end ? 'to-end' : ''}" role="log" aria-label="대화" ${ms('T1', '대화(메시지·스트리밍)')}>${inner}</div>`;
  /** The first exchange, finished. */
  const exchange1 = ({ tag = true, current = -1, open = false } = {}) =>
    userMsg({ text: Q1, quote: true, scope: [1, 2, 0], tag, open }) + answer1({ tag, current });

  /** Inspector head: the mode switch (from T1 on), then the tutor's own buttons. */
  function inspHead({ mode = 'tutor', hover = null, sessionsOn = false, buttons = true, newDisabled = false } = {}) {
    const seg = (id, label, key) =>
      `<span class="seg ${mode === id ? 'is-on' : ''} ${hover === id ? 'is-hover' : ''}" id="mode-${id}" role="tab" aria-selected="${mode === id}" title="${label} ${key}">${label}</span>`;
    const tutorButtons =
      mode === 'tutor' && buttons
        ? `${tu.sessions === 'panel' ? `<span class="icon-btn ${sessionsOn ? 'is-on' : ''}" id="sessions-btn" title="세션 목록" ${ms('T1', '세션 목록 단추(패널 머리)')}>${icon('history')}</span>` : ''}
           <span class="icon-btn ${newDisabled ? 'is-disabled' : ''}" title="${newDisabled ? '새 세션 — 지금 세션이 비어 있습니다' : '새 세션'}" ${ms('T1', '새 세션')}>${icon('square-pen')}</span>`
        : '';
    return `<div class="insp-head">
      <div class="segmented mode" role="tablist" aria-label="오른쪽 패널" ${ms('T1', '인스펙터 모드 전환 [정보 | 튜터]')}>${seg('info', '정보', '⌃⌘1')}${seg('tutor', '튜터', '⌃⌘2')}</div>
      <span class="spacer"></span>${tutorButtons}
    </div>`;
  }
  const tip = (anchor, label, sc = '') => `<span class="tooltip" data-anchor="${anchor}" role="tooltip">${label}${sc ? `<span class="sc">${sc}</span>` : ''}</span>`;

  /**
   * Composer. The reader's current selection attaches itself (× removes it); send becomes stop while answering.
   * The agent button shows nothing extra when the agent is ready, and its state in words when it is not.
   */
  function composer({ text = '', attach = false, material = false, streaming = false, focus = false, disabled = false, tag = true, agent: status = 'ready', menuOpen = false } = {}) {
    const agent =
      tu.backend === 'fake'
        ? `<span class="btn small plain has-icon has-menu tu-agent fake" title="가짜 백엔드 · 개발·데모 빌드에서만 보입니다">${icon('flask-conical', 'sm')}가짜 백엔드${icon('chevron-down', 'xs')}</span>`
        : status === 'ready'
          ? `<span class="btn small plain has-menu tu-agent ${menuOpen ? 'is-pressed' : ''}" id="agent-btn" title="에이전트: Codex · 준비됨 — 누르면 에이전트를 바꿉니다">Codex${icon('chevron-down', 'xs')}</span>`
          : `<span class="btn small plain has-icon has-menu tu-agent warn" id="agent-btn" title="에이전트: Codex · 로그인 필요 — 누르면 에이전트를 바꿉니다">${icon('log-in', 'sm')}Codex · 로그인 필요${icon('chevron-down', 'xs')}</span>`;
    const action = streaming
      ? `<span class="btn has-icon" title="중지 esc">${icon('circle-stop', 'sm')}중지</span>`
      : `<span class="btn primary square ${text && !disabled ? '' : 'is-disabled'}" title="${disabled ? '보내기 — 에이전트를 고르면 쓸 수 있습니다' : '보내기 ↩'}">${icon('arrow-up')}</span>`;
    const chips = [
      material ? `<div class="attach ctx" title="이 세션의 자료" ${tag ? ms('T1', '세션의 자료 칩(라이브러리 보기)') : ''}>${icon('file-text', 'sm')}<span class="ellipsis">${esc(T.item)}</span></div>` : '',
      attach ? `<div class="attach" title="질문에 붙은 구간 · 42쪽 — 질문과 함께 보냅니다">${icon('text-quote', 'sm')}<span class="ellipsis">42쪽 · ${esc(T.selection.text)}</span><span class="x" title="구간 떼기">${icon('x', 'xs')}</span></div>` : '',
    ].join('');
    const caret = focus ? '<span class="caret"></span>' : '';
    const input = text ? `<div class="input">${esc(text)}${caret}</div>` : `<div class="input placeholder">${caret}${streaming ? '다음 질문을 입력하세요' : '질문을 입력하세요'}</div>`;
    return `<div class="tu-composer ${focus ? 'is-focus' : ''} ${disabled ? 'is-disabled' : ''}" ${tag ? ms('T1', '입력창(구간 첨부 · 에이전트 단추 · 보내기 · 중지)') : ''}>
      ${chips}${input}
      <div class="foot">${agent}<span class="spacer"></span>${streaming ? '<span class="t-footnote c-secondary">답하는 중…</span>' : ''}${action}</div>
    </div>`;
  }
  const agentMenu = () => `<div class="menu" data-anchor="agent-btn" data-place="above" style="width:272px" role="menu" ${ms('T1', '에이전트 메뉴')}>
      ${mi('Codex', { check: true })}
      ${mi('Claude Code — 연결 도구 필요', { disabled: true, title: 'Learn과 연결하는 도구를 설치한 뒤 에이전트 고르기에서 다시 확인하세요' })}
      ${mi('Gemini CLI — 로그인 필요', { disabled: true, title: '터미널에서 로그인한 뒤 에이전트 고르기에서 다시 확인하세요' })}
      ${mi('opencode — 지원하지 않는 버전', { disabled: true, title: '최신 버전으로 업데이트하세요' })}
      <div class="msep"></div>
      ${mi('에이전트 고르기…')}
    </div>`;
  const fakeBanner = () =>
    tu.backend === 'fake' ? `<div class="tu-banner" role="status" ${ms('T1', '가짜 백엔드 표시')}>${icon('flask-conical', 'sm')}가짜 백엔드 · 정해 둔 답을 돌려줍니다(개발·데모 빌드)</div>` : '';

  // Reader beside the tutor. Pages are zoomed to fit the stage ("자동 맞춤" keeps ≥ 12 px either side).
  // `attached`: the passage attached to the question (Learn's own mark — a margin bar and a neutral wash,
  // never the find colour). `ring`: the page a pressed citation points to (page precision, for a moment).
  function stage({ pages = [42, 43], top = 16, zoom = 1, attached = false, ring = null } = {}) {
    const body = (n) => {
      let h = pageBody(n, { find: false }).replace('class="hl"', 'class=""'); // M9 highlight left out of the tutor renders
      if (attached && n === 42) {
        h = h
          .replace(`<p>${T.selection.text.slice(0, 5)}`, `<p class="has-attach"><span class="attach-bar" title="질문에 붙은 구간"></span>${T.selection.text.slice(0, 5)}`)
          .replace(T.selection.text, `<span class="attached" ${ms('T1', '질문에 붙은 구간 표시')}>${T.selection.text}</span>`);
      }
      return h;
    };
    return `<div class="pdf-stage tu-stage" style="--pg-zoom:${zoom}"><div class="pdf-scroll" style="top:${top}px">${pages
      .map((n) => `<div class="pdf-page ${ring === n ? 'cite-page' : ''}" aria-label="${n}쪽" ${ring === n ? ms('T1', '인용한 쪽 표시(누른 뒤 잠시)') : ''}>${body(n)}</div>`)
      .join('')}</div></div>`;
  }
  const fitZoom = (mainW) => {
    const avail = mainW - 1 - 24; // stage minus the inspector border, 12 px each side
    return avail >= 794 ? 1 : Math.floor(((mainW - 1 - 32) / 794) * 100) / 100;
  };

  /** Reader window with the right slot. `panel` null = slot folded. `slotW` = the open mode's width. */
  function readerWindow({ panel, slotW = tu.width, tutorMode = true, page = '42', current = 42, nav = 'thumbs', navList = '', stageOpts = {}, overlays = '', noSidebar = false, mainTip = '', winW = 1440, winH = 700, desktop = false }) {
    const mainW = winW - (noSidebar ? 0 : 240) - (panel ? slotW : 0);
    const zoom = fitZoom(mainW);
    // Below the full toolbar width the annotation group folds into "필기 ▾" (the M9 step of the narrow-window rule).
    const tools = mainW < READER_MIN.m9 ? 'compact' : 'full';
    const toggle = `<span class="toolbar-sep"></span><span class="icon-btn ${panel ? 'is-on' : ''}" id="slot-toggle" title="${SLOT_TOGGLE(!!panel)}" ${ms('T1', '오른쪽 패널 보기·가리기')}>${icon('panel-right')}</span>`;
    const main = `${pdfToolbar({ find: false, page, zoom: `${Math.round(zoom * 100)}%`, trailing: toggle, tools })}
      <div class="reader-body">${stage({ ...stageOpts, zoom })}</div>${mainTip}`;
    const sessionsSeg = tu.sessions === 'sidebar' ? navList || 'seg' : null;
    return M.windowShell({
      tabs: M.standardTabs('pdf'),
      // The M9 highlight is left out of the tutor renders (stage and thumbnails alike).
      sidebar: noSidebar ? '' : pdfSidebar(nav, { sessions: sessionsSeg, current }).replaceAll('class="hl"', 'class=""'),
      main,
      inspector: panel,
      overlays,
      cls: panel && tutorMode ? 'has-tutor' : '',
      style: `--tutor-w:${tu.width}px;${desktop ? `--win-w:${winW}px;--win-h:${winH}px` : ''}`,
    });
  }

  // Session lists. Rename in place (double-click or ↩); delete with ⌘⌫ or the row's native context menu
  // (7.3 "세션") — the same row grammar as collections, in the sidebar and in the panel list alike.
  /** Session row: title only — the day group says the day; the time is in the tooltip (navRow's title). */
  const sessionRow = (r, { indent = 0, selected = false } = {}) =>
    navRow({ label: r.title, ic: 'message-square', indent, selected }).replace('role="treeitem"', `role="treeitem" title="${esc(r.title)} · ${r.at}"`);
  const renameRow = (r) =>
    `<div class="nav-row is-renaming" role="treeitem" ${ms('T1', '세션 이름 바꾸기(제자리, ↩ 확인 · esc 취소)')}>${icon('message-square')}<div class="field small is-focus"><span class="value ellipsis"><span class="text-sel">${esc(r.title)}</span></span></div></div>`;
  /** `deleting`: the row being deleted (the delete sheet's subject) is the selected one. */
  const dayGroups = ({ rename = true, deleting = false } = {}) =>
    T.itemSessions
      .map((g) => `<div class="section-label">${g.group}</div>` + g.rows.map((r) => (rename && r.rename ? renameRow(r) : sessionRow(r, { selected: deleting ? !!r.rename : r.current }))).join(''))
      .join('');
  /** Reader sidebar, 4th segment "세션": this item's sessions by day; one row renamed in place. */
  function readerSessions() {
    if (tu.empty) {
      return `<div class="pane-empty top" ${ms('T1', '세션 칸 빈 상태')}>${icon('message-square')}<div class="pe-title">이&nbsp;자료의 세션이 없습니다</div><div class="pe-text">튜터에게 질문하면 여기에 생깁니다.</div></div>`;
    }
    return `<div class="sidebar-scroll tu-sess" role="tree" aria-label="세션" ${ms('T1', '세션 목록(이 자료, 최근 순)')}>${dayGroups({ rename: !tu.sheet, deleting: tu.sheet === 'delete' })}</div>`;
  }
  /** Library sidebar section "세션": recent sessions grouped by item (up to 5 items × 3 sessions). */
  const librarySessions = () =>
    `<div class="tu-lib-sessions" ${ms('T1', '세션 묶음(라이브러리 사이드바, 자료별·최근)')}>
      <div class="section-label">세션</div>
      ${T.recentSessions
        .map((g) => navRow({ label: g.item, ic: 'file-text', children: true, open: true, muted: true }) + g.rows.map((r) => sessionRow(r, { indent: 1 })).join(''))
        .join('')}
    </div>`;
  /** ?sessions=panel: a list that drops from the tutor head's list button over the conversation. */
  const panelSessions = () => `<div class="tu-sessions" role="dialog" aria-label="세션 목록" ${ms('T1', '세션 목록(패널 머리의 목록)')}>
      <div class="ts-head">
        <div class="segmented fill" ${ms('T1', '세션 범위(이 자료 · 모든 자료)')}><span class="seg is-on">이&nbsp;자료</span><span class="seg">모든 자료</span></div>
        <div class="field small" ${ms('T1', '세션 찾기')}>${icon('search', 'sm')}<span class="placeholder">세션 찾기</span></div>
      </div>
      <div class="ts-list" role="listbox">${dayGroups()}</div>
    </div>`;
  /**
   * Session delete: a simple confirmation, so `dialog.showMessageBox(win, { type: 'warning', buttons: ['취소', '삭제'],
   * defaultId: 0, cancelId: 0 })` as a sheet. Drawn with the sheet grammar (design-spec 6): warning badge, the
   * session as an item card, "삭제" as a danger-text button on the left, 취소 the default (↩ · esc) — the action
   * cannot be undone.
   */
  const deleteSheet = () => `<div class="dialog" role="alertdialog" aria-label="세션 삭제" ${ms('T1', '세션 삭제 확인 시트')}>
      <div class="d-body">
        <div class="d-title"><span class="badge-icon warning">${icon('trash-2')}</span><div><h2>이&nbsp;세션을 삭제하겠습니까?</h2></div></div>
        <p class="d-text">대화와 보낸 범위 기록을 지웁니다. 자료와 필기는 그대로 남습니다. 삭제한 세션은 되돌릴 수 없습니다.</p>
        <div class="card item-card"><span class="thumb">${icon('message-square')}</span>
          <div style="min-width:0"><div class="t-headline ellipsis">cAMP와 칼슘 이온은 어떻게 다른가요?</div><div class="t-footnote c-secondary ellipsis">${esc(T.item)} · 오늘 오전 8:50</div></div></div>
      </div>
      <div class="d-foot"><div class="btn plain danger-text leading">삭제</div><span class="spacer"></span><div class="btn primary" title="↩ · esc">취소</div></div>
    </div>`;

  // Consent (state 2) — what goes out is ADR-0010 §3's context plus this session's earlier turns and the
  // material's name; the account sentence holds for a subscription, an API key and a local model alike.
  const CONSENT_LEAD =
    '튜터는 이&nbsp;Mac에 설치한 에이전트 프로그램으로 답합니다. 에이전트는 사용자가 그&nbsp;프로그램에 직접 설정한 계정이나 API 키, 또는 로컬 모델로 돌고, 질문도 그&nbsp;서비스나 모델이 처리합니다. 계정을 쓰면 사용량과 요금도 그&nbsp;계정에서 나갑니다.';
  const consentFacts = () => `<dl class="tu-facts">
      <dt>${icon('send')}</dt><dd><div class="f-title">보내는 것</div><div class="f-text">지금 질문과 이&nbsp;세션의 앞선 대화, 선택한 구간, 자료의 이름, 튜터가 이&nbsp;자료에서 찾아 읽은 쪽, 관련 기억(기억 기능이 생긴 뒤)</div></dd>
      <dt>${icon('eye-off')}</dt><dd><div class="f-title">보내지 않는 것</div><div class="f-text">라이브러리 전체와 다른&nbsp;자료는 보내지 않습니다.</div></dd>
      <dt>${icon('shield-check')}</dt><dd><div class="f-title">에이전트의 도구</div><div class="f-text">파일·셸 도구를 끄고, Learn이 허락한 자료만 읽게 합니다.</div></dd>
      <dt>${icon('key-round')}</dt><dd><div class="f-title">로그인</div><div class="f-text">로그인 정보와 API 키는 에이전트 프로그램이 직접 다룹니다. Learn은 이를 따로 저장하지 않습니다.</div></dd>
    </dl>`;
  const CONSENT_NOTE = '질문마다 보낸 범위가 질문 아래에 표시됩니다.';
  const consentCard = () => `<div class="tu-consent" role="region" aria-label="튜터 사용 동의" ${ms('T1', '첫 사용 동의(패널 안 카드)')}>
      <div class="c-head"><span class="badge-tile">${icon('graduation-cap')}</span><h2>튜터는 이&nbsp;Mac의 에이전트로 답합니다</h2></div>
      <p class="tu-text">${CONSENT_LEAD}</p>
      ${consentFacts()}
      <p class="tu-text small">${CONSENT_NOTE}</p>
      <div class="c-actions"><span class="btn">나중에</span><span class="btn primary" title="동의 — 카드에 포커스가 있으면 ↩">동의</span></div>
    </div>`;
  const consentSheet = () => `<div class="dialog" role="alertdialog" aria-label="튜터 사용 동의" ${ms('T1', '첫 사용 동의(시트)')}>
      <div class="d-body">
        <div class="d-title"><span class="badge-icon">${icon('graduation-cap')}</span><div><h2>튜터는 이&nbsp;Mac의 에이전트로 답합니다</h2></div></div>
        <p class="d-text">${CONSENT_LEAD}</p>
        ${consentFacts()}
        <p class="d-text small">${CONSENT_NOTE}</p>
      </div>
      <div class="d-foot"><span class="spacer"></span><div class="btn" title="esc">나중에</div><div class="btn primary" title="↩">동의</div></div>
    </div>`;
  const tutorOff = () => `<div class="pane-empty" ${ms('T1', '튜터 꺼짐(동의 전 · 나중에)')}>${icon('graduation-cap')}
      <div class="pe-title">튜터가 꺼져 있습니다</div>
      <div class="pe-text">튜터를 쓰려면 먼저 에이전트에 보내는 범위에 동의해야 합니다. 자료 읽기와 필기는 튜터 없이도 모두 쓸 수 있습니다.</div>
      <div class="btn">튜터 켜기…</div></div>`;

  // Agents (state 3)
  const AGENT_FLAG = {
    ready: ['c-success', 'circle-check', '준비됨'],
    login: ['c-warning', 'log-in', '로그인 필요'],
    missing: ['c-secondary', 'circle-dashed', '설치 안 됨'],
    old: ['c-warning', 'triangle-alert', '지원하지 않는 버전'],
    adapter: ['c-warning', 'plug', '연결 도구 필요'],
  };
  /** A shell command that wraps only between words and after a package scope's "/" — never inside a name. */
  const cmdHtml = (cmd) =>
    cmd
      .split(' ')
      .map((w) => w.split(/(?<=\/)/).map((part) => `<span class="nobr">${esc(part)}</span>`).join('<wbr>'))
      .join(' ');
  const agentRow = (a, { focus = false, tag = false } = {}) => {
    const [c, ic, label] = AGENT_FLAG[a.status];
    const ok = a.status === 'ready';
    const action =
      a.status === 'login' || a.status === 'old' || a.status === 'adapter'
        ? `<span class="btn small a-action" title="${esc(a.name)}의 상태를 다시 확인합니다" ${tag ? ms('T1', '다시 확인(에이전트 행)') : ''}>다시 확인</span>`
        : '';
    // The adapter's install command: code (mono, wraps), with a copy button — a technical value, so only here.
    const cmd = a.cmd
      ? `<span class="a-cmd"><span class="tu-cmd mono">${cmdHtml(a.cmd)}</span><span class="icon-btn sm" title="명령 복사" ${tag ? ms('T1', '연결 도구 설치 명령 복사') : ''}>${icon('copy', 'sm')}</span></span>`
      : '';
    return `<div class="agent-row ${ok ? '' : 'is-unavailable'}" role="radio" aria-checked="${ok}" ${ok ? '' : 'aria-disabled="true"'}>
      <span class="radio ${ok ? 'is-on' : ''} ${focus ? 'is-focus' : ''}"></span>
      <span class="a-name">${esc(a.name)}<span class="inline-flag t-footnote ${c}">${icon(ic, 'sm')}${label}</span></span>
      <span class="a-text">${a.text}</span>${action}${cmd}
    </div>`;
  };
  const fakeAgentRow = () => `<div class="agent-row" role="radio" aria-checked="false"><span class="radio"></span>
      <span class="a-name">가짜 백엔드<span class="badge-soft warn">개발용</span></span>
      <span class="a-text">정해 둔 답과 인용을 돌려줍니다.</span></div>`;
  function agentPicker() {
    const head = `<div class="tu-title"><span class="tu-section-title">에이전트 고르기</span></div>
      <p class="tu-text">튜터는 이&nbsp;Mac에 설치된 에이전트로 답합니다. 로그인은 각&nbsp;에이전트에서 합니다.</p>`;
    const dev = `<div ${ms('T1', '가짜 백엔드(개발·데모 빌드에서만)')}><div class="group-label">개발·데모 빌드에서만 보입니다</div><div class="agent-group dev">${fakeAgentRow()}</div></div>`;
    const foot = ({ start = 'Codex로 시작', why = '', searching = false } = {}) =>
      `<div class="tu-foot"><span class="btn plain leading ${searching ? 'is-disabled' : ''}" title="설치된 에이전트를 다시 찾습니다" ${ms('T1', '에이전트 다시 찾기')}>다시 찾기</span><span class="spacer"></span><span class="btn primary ${why ? 'is-disabled' : ''}" title="${why || '↩'}" ${ms('T1', '에이전트로 시작')}>${start}</span></div>`;
    if (tu.agents === 'none') {
      // Final state with nothing to choose: no list and no start button — the one action is "다시 찾기".
      return `<div class="tu-scroll">${head}
        <div class="pane-empty" ${ms('T1', '에이전트 없음')}>${icon('unplug')}<div class="pe-title">설치된 에이전트가 없습니다</div>
          <div class="pe-text">Gemini CLI나 opencode는 설치하고 로그인하면 바로 쓸 수 있습니다. Codex와 Claude Code는 Learn과 연결하는 도구도 함께 설치해야 합니다.</div>
          <div class="btn" title="설치된 에이전트를 다시 찾습니다">다시 찾기</div>
          <span class="btn plain accent has-icon" title="설치 안내를 기본 브라우저로 엽니다" ${ms('T1', '설치 안내 보기(도움말, 기본 브라우저)')}>${icon('external-link', 'sm')}설치 안내 보기</span></div>
      </div>`;
    }
    if (tu.agents === 'searching') {
      // Transient: shown after 300 ms; the controls stay where they are, disabled.
      return `<div class="tu-scroll">${head}
        <div class="loading tu-searching" ${ms('T1', '에이전트 찾는 중')}><span class="spinner"></span>에이전트를 찾는 중…</div>
      </div>${foot({ start: '시작', why: '에이전트를 찾는 중입니다', searching: true })}`;
    }
    // blocked: none ready — Codex signed out, Gemini CLI not installed (the other rows as in the list).
    const list =
      tu.agents === 'blocked'
        ? T.agents.map((a) =>
            a.id === 'codex'
              ? { ...a, status: 'login', text: '터미널에서 <span class="mono">codex login</span>을 실행해 로그인한 뒤 다시 확인하세요.' }
              : a.id === 'gemini'
                ? { ...a, status: 'missing', text: '설치되어 있지 않습니다. 설치하고 로그인한 뒤 다시 찾기를 누르세요.' }
                : a,
          )
        : T.agents;
    const ready = list.some((a) => a.status === 'ready');
    return `<div class="tu-scroll" ${ms('T1', '에이전트 고르기(감지된 에이전트와 상태)')}>${head}
        <div class="agent-group" role="radiogroup" aria-label="에이전트">${list.map((a, i) => agentRow(a, { focus: a.status === 'ready', tag: i === 1 })).join('')}</div>
        ${dev}
      </div>${ready ? foot() : foot({ start: '시작', why: '준비된 에이전트가 없습니다 — 로그인한 뒤 다시 확인하세요' })}`;
  }

  // Proposal cards (state 7) — M9 note · check question, M10 memory (ADR-0010 §2 "제안"). The sheet order:
  // discard on the left, confirm on the right.
  const proposalActions = (save, { saveDisabled = false } = {}) =>
    `<div class="p-actions"><span class="btn small plain leading">버리기</span><span class="spacer"></span><span class="btn small">고치기</span><span class="btn small ${saveDisabled ? 'is-disabled' : ''}" ${saveDisabled ? 'title="붙일 위치를 확인하지 못했습니다"' : ''}>${save}</span></div>`;
  const noteCard = ({ st = '', unverifiedAnchor = false } = {}) => `<div class="proposal ${st}" ${ms('M9', '노트 제안 카드')}>
      <div class="p-head">${icon('sticky-note', 'sm')}노트 제안${unverifiedAnchor ? unverified(57) : cite(42, { title: '노트가 붙을 쪽 · 42쪽으로 이동' })}</div>
      <div class="p-body">증폭 배율 = 각 단계 배율의 곱. 수용체가 G 단백질을 약 100개, 고리화효소가 cAMP를 약 100개 켜면 두 단계로 만 배. 실제로는 끄는 반응 때문에 더 작다.</div>
      ${unverifiedAnchor ? `<div class="p-meta c-warning">붙일 쪽을 확인하지 못해 저장할 수 없습니다. 고친 뒤 쪽을 고르세요.</div>${proposalActions('노트로 저장', { saveDisabled: true })}` : proposalActions('노트로 저장')}
    </div>`;
  const checkCard = () => `<div class="proposal" ${ms('M9', '확인 문제 카드')}>
      <div class="p-head">${icon('list-checks', 'sm')}확인 문제 제안${cite(42, { title: '문제가 붙을 쪽 · 42쪽으로 이동' })}</div>
      <div class="p-body">수용체 하나가 G 단백질 50개를 켜고, 고리화효소 하나가 cAMP 200개를 만든다면 두 단계의 배율은 얼마입니까?</div>
      <div class="p-meta">정답 · 50 × 200 = 10,000배</div>
      ${proposalActions('문제로 저장')}
    </div>`;
  const memoryCard = () => `<div class="proposal" ${ms('M10', '기억 제안 카드')}>
      <div class="p-head">${icon('brain', 'sm')}기억 제안<span class="badge-soft">추정</span></div>
      <div class="p-body">증폭 배율을 단계 배율의 곱으로 이해했습니다.</div>
      <div class="p-meta">근거<span class="cite" role="link" title="이 세션의 첫 질문으로 이동">${icon('message-square', 'xs')}첫 질문 · 오전 9:31</span></div>
      ${proposalActions('기억에 추가')}
    </div>`;
  const learnNote = (text) => `<div class="tu-learn-note">${icon('info', 'sm')}<span>${text}</span></div>`;

  // Failures (state 8): a request that fails before any answer returns to the composer as a draft, sent from
  // there with ↩ (one way to send); one that fails mid-answer keeps the partial answer and offers "다시 보내기".
  const failNotice = (ic, cls, title, text, actions = '', extra = '') =>
    `<div class="tu-notice" role="alert" ${ms('T1', '실패 안내')}>${icon(ic, cls)}<div class="nt">${title}</div><div class="nt-text">${text}</div>${extra}${actions ? `<div class="nt-actions">${actions}</div>` : ''}</div>`;
  function failure() {
    if (tu.fail === 'agent') {
      return {
        inner:
          exchange1({ tag: false }) +
          userMsg({ text: Q2, scope: [1, 1, 0] }) +
          tutorMsg({
            tools: [tool('book-open-text', '42쪽 읽음', { title: '42쪽 본문을 읽었습니다' })],
            body: `<p>${A2_LEAD.split(',')[0]},<span class="tu-cut"> …</span></p>`,
            foot: failNotice('circle-alert', 'c-danger', 'Codex가 답하는 도중 멈췄습니다', '에이전트 프로그램이 예기치 않게 종료되어 답이 중간에 끊겼습니다. 다시 보내면 에이전트를 다시 시작하고 같은 질문을 처음부터 묻습니다.', `<span class="btn small" title="같은 질문을 처음부터 다시 묻습니다" ${ms('T1', '다시 보내기(답 도중 실패)')}>다시 보내기</span>`),
          }),
        composer: composer({}),
      };
    }
    const n =
      tu.fail === 'login'
        ? failNotice('log-in', 'c-warning', 'Codex 로그인이 만료되었습니다', '질문을 보내지 못했습니다. 터미널에서 아래 명령으로 다시 로그인한 뒤 입력창에서 ↩로 보내세요. 질문은 입력창에 그대로 있습니다.', '', `<div class="nt-cmd"><span class="tu-cmd mono">codex login</span><span class="icon-btn sm" title="명령 복사" ${ms('T1', '명령 복사(로그인 안내)')}>${icon('copy', 'sm')}</span></div>`)
        : failNotice('wifi-off', 'c-warning', '인터넷에 연결되어 있지 않습니다', '질문을 보내지 못했습니다. 연결을 확인한 뒤 입력창에서 ↩로 보내세요. 질문은 입력창에 그대로 있습니다.');
    return { inner: sessionTitle() + exchange1({ tag: false }) + n, composer: composer({ text: Q2, focus: true, agent: tu.fail === 'login' ? 'login' : 'ready' }) };
  }

  /** The tutor panel: head, optional fake-backend strip, body, composer, overlays. */
  const panel = ({ head = {}, body, comp = '', overlay = '', tooltip = '' }) => `${inspHead(head)}${fakeBanner()}${body}${comp}${overlay}${tooltip}`;
  /** 정보 mode: the approved item panel under the same 44 px head (no tutor buttons). In the reader the item is open, so no "열기". */
  const infoPanel = ({ reader = false, tooltip = '' } = {}) => {
    let item = inspectorItem();
    if (reader) {
      item = item
        .replace('<div class="btn primary" title="열기 ↩">열기</div>', '')
        .replace(/<span class="num">(\d+ \/ \d+쪽)<\/span>에서 멈춤 · [^<]*/, '지금 <span class="num">$1</span>');
    }
    return `${inspHead({ mode: 'info', hover: 'tutor' })}${item}${tooltip}`;
  };

  function tutorScreen() {
    document.documentElement.dataset.msg = tu.msg;
    document.documentElement.dataset.page = tu.page ?? (M.isDark() ? 'dark' : 'original'); // the reader's default page colour unless ?page=
    const s = tu.state;
    const convo = (inner, opts = {}) => panel({ body: thread(inner, opts.thread), comp: composer(opts.comp), ...opts.panel });

    if (tu.view === 'library') {
      if (tu.mode === 'info') {
        // The library remembers 정보: the approved item panel with the mode switch above it.
        return M.windowShell({
          tabs: M.standardTabs('library'),
          sidebar: librarySidebar({ extra: librarySessions(), collapsed: true }),
          main: libraryHeader({ toggleTitle: SLOT_TOGGLE(true), toggleMs: ['T1', '오른쪽 패널 보기·가리기'] }) + libraryTable({ selectedIds: [1], focused: true }),
          inspector: infoPanel({ tooltip: tip('mode-tutor', '튜터', '⌃⌘2') }),
          cls: 'has-modes',
        });
      }
      // The one library sheet of the tutor: tutor mode beside the table, sessions grouped by item in the sidebar.
      const p = convo(sessionTitle({ item: true }) + exchange1({}), { thread: { end: false }, comp: { focus: true, material: true } });
      return M.windowShell({
        tabs: M.standardTabs('library'),
        sidebar: librarySidebar({ extra: librarySessions(), collapsed: true }),
        main: libraryHeader({ toggleTitle: SLOT_TOGGLE(true), toggleMs: ['T1', '오른쪽 패널 보기·가리기'] }) + libraryTable({ selectedIds: [1], focused: false }),
        inspector: p,
        cls: 'has-tutor',
        style: `--tutor-w:${tu.width}px`,
      });
    }
    if (tu.menu === 'agent') {
      return readerWindow({ panel: convo(sessionTitle() + exchange1({}), { thread: { end: false }, comp: { menuOpen: true }, panel: { overlay: agentMenu() } }) });
    }
    switch (s) {
      case 1:
        if (tu.mode === 'info') {
          // 정보 in the reader: the slot narrows to 정보's own width (320) and the page is fitted again.
          return readerWindow({ panel: infoPanel({ reader: true, tooltip: tip('mode-tutor', '튜터', '⌃⌘2') }), slotW: 320, tutorMode: false });
        }
        return readerWindow({
          panel: panel({ head: { hover: 'info' }, body: thread(sessionTitle() + exchange1({}), { end: false }), comp: composer({}), tooltip: tip('mode-info', '정보', '⌃⌘1') }),
        });
      case 2:
        if (tu.consent === 'sheet') return readerWindow({ panel: panel({ head: { buttons: false }, body: tutorOff() }), overlays: consentSheet() });
        return readerWindow({ panel: panel({ head: { buttons: false }, body: tu.later ? tutorOff() : `<div class="tu-scroll">${consentCard()}</div>` }) });
      case 3:
        return readerWindow({ panel: panel({ head: { buttons: false }, body: agentPicker() }) });
      case 4:
        return readerWindow({
          panel: panel({ head: { newDisabled: true }, body: `<div class="pane-empty" ${ms('T1', '빈 세션')}>${icon('file-text')}<div class="pe-title">${esc(T.item)}</div><div class="pe-text">이&nbsp;자료에 대해 물어보세요. 본문에서 구간을 선택하면 질문에 붙고, 답에는 근거가 된 쪽이 함께 표시됩니다.</div></div>`, comp: composer({ attach: true, focus: true }) }),
          stageOpts: { attached: true },
        });
      case 6:
        return readerWindow({
          panel: convo(exchange1({ current: 2 }) + userMsg({ text: Q2, scope: [1, 1, 0] }) + answer2({ done: true, tag: true })),
          page: '41',
          current: 41,
          stageOpts: { pages: [41, 42], ring: 41 },
        });
      case 7:
        return readerWindow({
          panel: convo(
            answer1({}) +
              userMsg({ text: Q3, scope: [1, 1, 0] }) +
              tutorMsg({ tools: [tool('book-open-text', '42쪽 읽음', { title: '42쪽 본문을 읽었습니다' })], body: '<p>아래처럼 정리해 보았습니다.</p>',
                foot: learnNote('제안은 저장하기 전까지 노트·문제·기억에 더해지지 않습니다.') + noteCard() + checkCard() + memoryCard(),
              }),
          ),
        });
      case 8: {
        const f = failure();
        return readerWindow({ panel: panel({ body: thread(f.inner), comp: f.composer }) });
      }
      case 9: {
        const overlays = tu.sheet === 'delete' ? deleteSheet() : '';
        if (tu.sessions === 'panel') {
          return readerWindow({ panel: panel({ head: { sessionsOn: true }, body: thread(sessionTitle() + exchange1({})), comp: composer({}), overlay: panelSessions() }), overlays });
        }
        if (tu.empty) {
          return readerWindow({
            panel: panel({ head: { newDisabled: true }, body: `<div class="pane-empty" ${ms('T1', '빈 세션')}>${icon('file-text')}<div class="pe-title">${esc(T.item)}</div><div class="pe-text">이&nbsp;자료에 대해 물어보세요. 본문에서 구간을 선택하면 질문에 붙고, 답에는 근거가 된 쪽이 함께 표시됩니다.</div></div>`, comp: composer({}) }),
            nav: 'sessions',
            navList: readerSessions(),
          });
        }
        return readerWindow({ panel: convo(sessionTitle() + exchange1({})), nav: 'sessions', navList: readerSessions(), overlays });
      }
      case 10: {
        // design-spec 2.5: the slot first shrinks to its minimum (tutor 320), then folds (T1 below 1000, M9 below 1200).
        // Opening it in a narrow window folds the sidebar (automatic, not saved; the side opened last wins); if the
        // reader is still short of the full toolbar (M9 only), the annotation group folds into "필기 ▾".
        const w = tu.fold === '960' ? 960 : 1040;
        const c = (inner) => convo(inner);
        const notes = {
          collapsed: `창 1040 · 튜터를 최소 320으로 줄여도 240 + 320 + 리더 ${READER_MIN.m9}(M9)이 들어가지 않아 오른쪽 패널이 접혔습니다 — 리더 800 (T1의 리더 ${READER_MIN.t1}이면 튜터가 360으로 줄어 남습니다)`,
          open: '창 1040 · 튜터를 펼치면 사이드바가 접힙니다(자동, 저장하지 않음) — 리더 660 + 튜터 380 · 여기서 사이드바를 펼치면 튜터가 접힙니다',
          960: '창 960(최소) · 튜터를 펼치면 사이드바가 접히고 리더 580 — M9 필기 묶음은 ‘필기 ▾’ 하나로 접힙니다',
        };
        const win =
          tu.fold === 'collapsed'
            ? readerWindow({ panel: null, winW: w, desktop: true, mainTip: tip('slot-toggle', '오른쪽 패널 보기', '⌥⌘I') })
            : readerWindow({ panel: c(sessionTitle() + exchange1({})), noSidebar: true, winW: w, winH: tu.fold === '960' ? 640 : 700, desktop: true });
        return `<div class="desktop">${win}<div class="sim-note">${notes[tu.fold]}</div></div>`;
      }
      default: // 5: conversation, answer streaming
        return readerWindow({
          panel: convo(sessionTitle() + exchange1({ open: true }) + userMsg({ text: Q2, scope: [1, 1, 0] }) + answer2({}), { comp: { streaming: true } }),
        });
    }
  }

  // ── Components board, part 4: tutor chips, lines, cards, composer ─────────
  function tutorBoard() {
    const row = (label, html, cls = '') => `<div class="state-row ${cls}"><span class="lbl">${label}</span>${html}</div>`;
    const fmts = (st) => ['page', 'p', 'icon'].map((f) => cite(42, { fmt: f, st })).join('');
    return `<div class="board">
      <header><h1>컴포넌트 상태 3 — 튜터</h1><p>인용 칩 · 도구 칩 · 보낸 범위 줄 · 제안 카드 · 입력창의 기본 · 호버 · 누름 · 포커스 · 비활성 · 검증 안 됨. 튜터 패널의 면(--bg-content) 위와 말풍선 안.</p></header>
      <div class="board-grid">
        <div class="tu-col">
          <section class="panel">
            <h3>인용 칩 — 쪽 · p. · 아이콘 + 숫자</h3>
            ${row('기본', `${fmts('')}<span class="cite" title="18:20으로 이동">${icon('clock', 'xs')}18:20</span><span class="note">시간(M8, 이 보드에만)</span>`)}
            ${row('호버', fmts('is-hover'))}
            ${row('누름', fmts('is-pressed'))}
            ${row('지금 위치', `${fmts('is-current')}<span class="note">누른 뒤 리더가 보여 주는 인용</span>`)}
            ${row('포커스', fmts('is-focus'))}
            ${row('비활성', `${fmts('is-disabled')}<span class="note">자료 원본이 없음 · 이유는 툴팁</span>`)}
            ${row('검증 안 됨', `${unverified(57)}${unverified(57, { st: 'is-hover' })}${unverified(57, { st: 'is-focus' })}<span class="note">기본 · 호버 · 포커스 — 누를 수 없음, 툴팁만</span>`)}
          </section>
          <section class="panel" data-msg="bubble">
            <h3>말풍선 안 — 칩의 기본 · 호버 · 누름 · 지금 위치 · 포커스 · 검증 안 됨</h3>
            ${[
              ['사용자', (st) => `<div class="tu-msg user"><div class="bubble"><p>${cite(42, { st })}${st === '' ? unverified(57) : ''}</p></div></div>`],
              ['튜터', (st) => `<div class="tu-msg tutor"><div class="body"><p>${cite(42, { st })}${st === '' ? unverified(57) : ''}</p></div></div>`],
            ]
              .map(([who, make]) =>
                [['기본', ''], ['호버', 'is-hover'], ['누름', 'is-pressed'], ['지금 위치', 'is-current'], ['포커스', 'is-focus']]
                  .map(([l, st]) => row(`${who} · ${l}`, make(st)))
                  .join(''),
              )
              .join('')}
            ${row('검증 안 됨 · 호버', `<div class="tu-msg tutor"><div class="body"><p>${unverified(57, { st: 'is-hover' })}</p></div></div>`)}
          </section>
          <section class="panel">
            <h3>제안 카드(M9 · M10) — 기본 · 검증 안 됨</h3>
            ${noteCard()}
            ${noteCard({ unverifiedAnchor: true })}
          </section>
        </div>
        <div class="tu-col">
          <section class="panel">
            <h3>도구 칩 · 보낸 범위 줄</h3>
            ${row('완료', tool('book-open-text', '41–42쪽 읽음') + tool('text-select', '선택한 구간 확인'))}
            ${row('진행 중', tool('', '43쪽 읽는 중…', { st: 'is-running' }))}
            ${row('실패', tool('circle-alert', '43쪽을 읽지 못함', { st: 'is-failed' }))}
            ${row('포커스', `${tool('book-open-text', '41–42쪽 읽음', { st: 'is-focus' })}<span class="note">누를 수 없는 상태 표시 · 호버와 포커스는 툴팁만</span>`)}
            ${row('범위 · 호버', `${scopeLine([1, 2, 0])}${scopeLine([1, 2, 0], { st: 'is-hover' })}`)}
            ${row('포커스', `${scopeLine([1, 2, 0], { st: 'is-focus' })}<span class="note">보내지 못한 요청에는 범위 줄이 없다</span>`)}
            <div class="state-row" style="align-items:flex-start"><span class="lbl">펼침</span><div class="tu-msg" style="flex:1 1 auto">${scopeLine([1, 2, 0], { open: true, list: SCOPE1_LIST })}</div></div>
          </section>
          <section class="panel">
            <h3>제안 카드 — 포커스 · 저장함(비활성)</h3>
            ${checkCard().replace('class="proposal"', 'class="proposal is-focus"')}
            <div class="proposal is-done">${icon('circle-check', 'sm c-success')}<span>노트로 저장했습니다 · 42쪽</span></div>
          </section>
        </div>
        <div class="tu-col">
          <section class="panel">
            <h3>입력창 — 비어 있음 · 입력 중(첨부) · 답하는 중 · 비활성</h3>
            ${composer({ tag: false })}
            ${composer({ tag: false, attach: true, focus: true, text: Q1 })}
            ${composer({ tag: false, streaming: true })}
            ${composer({ tag: false, disabled: true })}
            ${row('칩', `<div class="attach">${icon('text-quote', 'sm')}<span class="ellipsis" style="max-width:100px">42쪽 · ${esc(T.selection.text)}</span><span class="x">${icon('x', 'xs')}</span></div><div class="attach is-hover">${icon('text-quote', 'sm')}<span>호버</span><span class="x">${icon('x', 'xs')}</span></div><div class="attach ctx">${icon('file-text', 'sm')}<span>자료</span></div>`)}
          </section>
          <section class="panel">
            <h3>모드 전환 · 실패 안내</h3>
            ${row('호버 · 포커스', `<div class="segmented mode"><span class="seg is-hover">정보</span><span class="seg is-on">튜터</span></div><div class="segmented mode is-focus"><span class="seg">정보</span><span class="seg is-on">튜터</span></div>`)}
            ${failNotice('wifi-off', 'c-warning', '인터넷에 연결되어 있지 않습니다', '질문을 보내지 못했습니다. 연결을 확인한 뒤 입력창에서 ↩로 보내세요.')}
          </section>
        </div>
      </div>
    </div>`;
  }

  // ── Components board, part 5: tutor lists, radio, agent menu ─────────────
  function tutorBoardLists() {
    const row = (label, html) => `<div class="state-row"><span class="lbl">${label}</span>${html}</div>`;
    const sess = (label, extra = {}) => navRow({ label, ic: 'message-square', ...extra });
    return `<div class="board">
      <header><h1>컴포넌트 상태 4 — 튜터 목록 · 선택</h1><p>라디오 · 에이전트 행 · 세션 행 · 에이전트 메뉴. 세션 행은 사이드바 행과 같은 문법(선택 규칙 3.1, 키보드 커서 6절)이고, 지우기는 ⌘⌫와 네이티브 컨텍스트 메뉴뿐이다.</p></header>
      <div class="board-grid">
        <div class="tu-col">
          <section class="panel">
            <h3>라디오</h3>
            ${row('끔 · 켬', `<span class="radio"></span><span class="radio is-on"></span>`)}
            ${row('포커스', `<span class="radio is-focus"></span><span class="radio is-on is-focus"></span>`)}
            ${row('비활성', `<span class="radio" style="opacity:.45"></span><span class="note">준비되지 않은 에이전트 · 이유는 행의 글</span>`)}
          </section>
          <section class="panel">
            <h3>에이전트 행 — 준비됨(선택·포커스) · 연결 도구 필요 · 로그인 필요 · 지원하지 않는 버전 · 설치 안 됨 · 개발용</h3>
            <div class="agent-group">${T.agents.map((a) => agentRow(a, { focus: a.status === 'ready' })).join('')}${agentRow({ id: 'x', name: 'Gemini CLI', status: 'missing', text: '설치되어 있지 않습니다. 설치하고 로그인한 뒤 다시 찾기를 누르세요.' })}</div>
            <div class="agent-group dev">${fakeAgentRow()}</div>
          </section>
        </div>
        <div class="tu-col">
          <section class="panel on-sidebar">
            <h3>세션 행(사이드바)</h3>
            ${sess('기본 · ‘각 단계 배율의 곱’이 무슨 뜻인지')}
            ${sess('호버', { cls: 'is-hover' })}
            ${sess('선택 · 포커스 없음', { selected: true })}
            ${sess('선택 · 포커스', { selected: true, focused: true })}
            ${sess('키보드 커서(선택 안 됨)', { cursor: true })}
            ${renameRow({ title: '이름 바꾸기(제자리)' })}
            <span class="note">시간은 행에 쓰지 않는다 — 날 묶음(오늘 · 어제 · 지난 7일)이 날을, 툴팁이 시간을 말한다</span>
          </section>
          <section class="panel">
            <h3>세션 행(패널 목록)</h3>
            ${sess('선택 · 포커스 없음', { selected: true })}
            ${sess('호버', { cls: 'is-hover' })}
            ${renameRow({ title: '이름 바꾸기(제자리)' })}
          </section>
        </div>
        <div class="tu-col">
          <section class="panel">
            <h3>에이전트 메뉴(입력창 단추, 웹 팝업)</h3>
            <div class="menu static-menu" role="menu">
              ${mi('Codex', { check: true })}
              ${mi('Claude Code — 연결 도구 필요', { disabled: true })}
              ${mi('Gemini CLI — 로그인 필요', { disabled: true })}
              ${mi('opencode — 지원하지 않는 버전', { disabled: true })}
              <div class="msep"></div>
              ${mi('에이전트 고르기…', { active: true })}
            </div>
            <span class="note">아래 공간이 없으면 단추 위 4px에 연다. 준비되지 않은 항목은 비활성, 이유는 툴팁.</span>
          </section>
          <section class="panel">
            <h3>에이전트 단추(입력창)</h3>
            ${row('준비됨', `<span class="btn small plain has-menu tu-agent">Codex${icon('chevron-down', 'xs')}</span>`)}
            ${row('누름', `<span class="btn small plain has-menu tu-agent is-pressed">Codex${icon('chevron-down', 'xs')}</span>`)}
            ${row('준비 안 됨', `<span class="btn small plain has-icon has-menu tu-agent warn">${icon('log-in', 'sm')}Codex · 로그인 필요${icon('chevron-down', 'xs')}</span>`)}
            ${row('가짜', `<span class="btn small plain has-icon has-menu tu-agent fake">${icon('flask-conical', 'sm')}가짜 백엔드${icon('chevron-down', 'xs')}</span>`)}
          </section>
        </div>
      </div>
    </div>`;
  }

  // ── Render entry ───────────────────────────────────────────────────────────
  const screens = {
    library: () => libraryWindow({}),
    'library-empty': () => emptyLibrary(state === 'drop'),
    'reader-pdf': pdfWindow,
    'reader-video': () => videoWindow(),
    palette: () => libraryWindow({ state: 'item', table: { focused: false }, overlays: palette() }),
    settings: () => libraryWindow({ state: 'item', table: { focused: false }, inactive: true, above: settingsWindow() }),
    components: componentsBoard,
    tutor: tutorScreen,
    dialogs: () => {
      const scene = params.get('scene') || 'duplicate';
      if (scene === 'codec') return videoWindow({ codec: true });
      const overlay = { duplicate: duplicateSheet() + importToast({ waiting: true }), backup: backupSheet(), recovery: recoverySheet() }[scene];
      return libraryWindow({ state: 'item', table: { focused: false }, overlays: overlay });
    },
  };

  M.render = (name) => M.mount(screens[name]());
})();
