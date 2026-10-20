/*
 * Screen templates. Each `Mockup.render(name)` call composes the window shell with a view.
 * Page parameters: library-empty ?state=empty|drop · reader-pdf ?page=auto|original|sepia|dark
 * &menu=zoom &nav=thumbs|outline · dialogs ?scene=duplicate|recovery|backup|codec.
 */
(() => {
  const M = window.Mockup;
  const D = window.MockupData;
  const { icon, esc, kbd, tagHex, params } = M;

  // ── Shared bits ────────────────────────────────────────────────────────────
  const navRow = ({ label, ic, count, indent = 0, selected, focused, children, open, muted, cls = '', ms }) => {
    const classes = ['nav-row', selected ? 'is-selected' : '', focused ? 'is-focused' : '', muted ? 'is-muted' : '', cls].join(' ');
    const disclosure = children ? `<span class="disclosure">${icon(open ? 'chevron-down' : 'chevron-right', 'xs')}</span>` : '';
    const c = count === undefined || count === null ? '' : `<span class="count">${count}</span>`;
    return `<div class="${classes}" style="--indent:${indent}" role="treeitem" ${ms ? `data-ms="${ms}"` : ''}>${disclosure}${icon(ic)}<span class="label ellipsis">${esc(label)}</span>${c}</div>`;
  };

  const tagChip = (n, extra = '') => {
    const t = Object.values(D.tags).find((x) => x.color === n);
    return `<span class="chip ${extra}"><span class="dot" style="background:${tagHex(n)}"></span>${esc(t.name)}</span>`;
  };

  const kindIcon = (kind) => (kind === 'video' ? 'clapperboard' : 'file-text');

  // ── Library: sidebar ───────────────────────────────────────────────────────
  function librarySidebar({ empty = false, selected = 'molbio', focused = false, dropTarget = null } = {}) {
    const lib = [
      { id: 'all', label: '내 라이브러리', ic: 'library-big', count: empty ? null : 128 },
      { id: 'recent', label: '최근 연 자료', ic: 'clock', ms: 'M5' },
      { id: 'unfiled', label: '미분류', ic: 'inbox', count: empty ? null : 12, ms: 'M5' },
      { id: 'dupes', label: '중복 항목', ic: 'copy', count: empty ? null : 2, ms: 'M5' },
      { id: 'trash', label: '휴지통', ic: 'trash-2', count: empty ? null : 3, ms: 'M6' },
    ]
      .map((r) => navRow({ ...r, selected: r.id === selected, focused: r.id === selected && focused }))
      .join('');

    let tree = '';
    if (empty) {
      tree = `<div class="sidebar-empty-hint">컬렉션이 없습니다. 자료를 묶으려면 새 컬렉션을 만드세요.</div>`;
    } else {
      for (const c of D.collections) {
        tree += navRow({
          label: c.name, ic: c.open ? 'folder-open' : 'folder', count: c.count, children: !!c.children, open: c.open,
          selected: c.id === selected, focused: c.id === selected && focused, cls: c.id === dropTarget ? 'is-drop-target' : '',
        });
        if (c.open) {
          for (const ch of c.children) {
            tree += navRow({ label: ch.name, ic: 'folder', count: ch.count, indent: 1, selected: ch.id === selected, focused: ch.id === selected && focused });
          }
        }
      }
    }

    const tagsHtml = empty
      ? ''
      : `<div class="tag-selector">
          <div class="head" data-ms="M5">태그<span class="spacer"></span><span class="icon-btn sm" title="태그 표시 옵션">${icon('ellipsis', 'sm')}</span></div>
          <div class="tag-cloud">
            ${[1, 2, 4, 5].map((n) => tagChip(n)).join('')}
            ${D.plainTags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
            ${D.dimTags.map((t) => `<span class="chip is-dim">${esc(t)}</span>`).join('')}
          </div>
          <div class="field small">${icon('search', 'sm')}<span class="placeholder">태그 필터</span></div>
        </div>`;

    return `
      <div class="launcher-wrap">${M.launcher()}</div>
      <div class="sidebar-scroll" role="tree">
        <div class="section-label">라이브러리</div>
        ${lib}
        <div class="section-label" data-ms="M5">컬렉션<span class="spacer"></span><span class="icon-btn sm" title="새 컬렉션 ⇧⌘N">${icon('folder-plus', 'sm')}</span></div>
        ${tree}
      </div>
      ${tagsHtml}`;
  }

  // ── Library: table ─────────────────────────────────────────────────────────
  const COLS = 'minmax(0, 1fr) 156px 52px 104px 120px';

  function progressCell(p) {
    if (p === null) return `<span class="c-tertiary">—</span>`;
    if (p === 100) return `<span class="inline-flag c-success">${icon('check', 'sm')}완료</span>`;
    return `<span class="progress"><i style="width:${p}%"></i></span><span class="num">${p}%</span>`;
  }

  function tableRow(it, { selected, focused, hover }) {
    const cls = ['table-row', selected ? 'is-selected' : '', focused ? 'is-focused' : '', hover ? 'is-hover' : '', it.missing ? 'is-missing' : ''].join(' ');
    const dots = it.tags.length ? `<span class="tag-dots">${it.tags.map((n) => `<i style="background:${tagHex(n)}"></i>`).join('')}</span>` : '';
    const linked = it.linked && !it.missing ? `<span class="c-tertiary" title="외부 파일 연결">${icon('link', 'sm')}</span>` : '';
    const missing = it.missing ? `<span class="inline-flag c-warning" title="원본 파일을 찾을 수 없습니다">${icon('triangle-alert', 'sm')}파일 없음</span>` : '';
    return `<div class="${cls}" role="row" aria-selected="${!!selected}">
      <div class="td" role="gridcell">${icon(kindIcon(it.kind))}<span class="title ellipsis">${esc(it.title)}</span>${linked}${dots}${missing}</div>
      <div class="td" role="gridcell"><span class="ellipsis">${esc(it.authors)}</span></div>
      <div class="td num" role="gridcell">${it.year}</div>
      <div class="td" role="gridcell">${progressCell(it.progress)}</div>
      <div class="td num" role="gridcell"><span class="ellipsis">${esc(it.added)}</span></div>
    </div>`;
  }

  function libraryTable({ selectedId = 1, focused = true, hoverId = null } = {}) {
    const head = [
      ['제목', ''], ['저자', ''], ['연도', ''], ['진행', ''], ['추가일', 'is-sorted'],
    ]
      .map(([l, c]) => `<div class="th ${c}" role="columnheader" ${l === '진행' ? 'data-ms="M7"' : l === '제목' ? 'data-ms="M4"' : ''}>${l}${c ? icon('chevron-down', 'xs') : ''}</div>`)
      .join('');
    const rows = D.items.map((it) => tableRow(it, { selected: it.id === selectedId, focused, hover: it.id === hoverId })).join('');
    return `<div class="table" role="grid" style="--cols:${COLS}">
      <div class="table-head" role="row">${head}</div>
      <div class="table-body">${rows}</div>
    </div>`;
  }

  function libraryHeader({ title = '분자생물학', count = '48개', searchFocus = false, inspectorOn = true, empty = false } = {}) {
    const search = searchFocus
      ? `<div class="field is-focus" style="width:240px">${icon('search', 'sm')}<span class="value">신호</span><span class="caret"></span><span class="spacer"></span>${icon('circle-x', 'sm')}</div>`
      : `<div class="field" style="width:240px" data-ms="M4">${icon('search', 'sm')}<span class="placeholder ellipsis">제목, 저자, 태그 검색</span></div>`;
    return `<div class="pane-header">
      <span class="title ellipsis">${esc(title)}</span>${count ? `<span class="count num">${count}</span>` : ''}
      <span class="spacer"></span>
      <div class="btn has-icon has-menu" title="가져오기 ⌘O" data-ms="M6">${icon('plus')}가져오기${icon('chevron-down', 'xs')}</div>
      ${empty ? '' : search}
      ${empty ? '' : `<div class="icon-btn ${inspectorOn ? 'is-on' : ''}" title="항목 패널 보기/숨기기 ⌥⌘I">${icon('panel-right')}</div>`}
    </div>`;
  }

  // ── Library: inspector ─────────────────────────────────────────────────────
  function inspector() {
    const it = D.selectedItem;
    const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    const sectionHead = (title, extra = '', ms = '') =>
      `<div class="section-head" ${ms ? `data-ms="${ms}"` : ''}>${icon('chevron-down', 'xs')}<span>${title}</span><span class="spacer"></span>${extra}</div>`;
    const r = it.reading;
    return `<div class="inspector-scroll">
      <div class="item-head" data-ms="M4">
        <div class="kind">${icon('file-text', 'sm')}${esc(it.kind)} · ${r.pages}쪽</div>
        <h2>${esc(it.title)}</h2>
        <div class="authors">${esc(it.authors)} · 2024</div>
        <div class="actions">
          <div class="btn primary" title="열기 ↩">열기</div>
          <div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div>
          <span class="spacer"></span>
          <div class="icon-btn" title="더 보기">${icon('ellipsis')}</div>
        </div>
      </div>
      <section class="section">
        ${sectionHead('읽기', '', 'M7')}
        <div class="row gap-8"><span class="progress wide thick"><i style="width:${r.percent}%"></i></span><span class="num t-footnote">${r.percent}%</span></div>
        <div class="t-footnote c-secondary" style="margin-top:6px"><span class="num">${r.page} / ${r.pages}쪽</span>에서 멈춤 · ${esc(r.opened)}</div>
      </section>
      <section class="section">
        ${sectionHead('정보', `<span class="icon-btn sm" title="정보 편집">${icon('pencil', 'sm')}</span>`)}
        ${kv(it.info)}
      </section>
      <section class="section">
        ${sectionHead('태그', `<span class="icon-btn sm" title="태그 추가">${icon('plus', 'sm')}</span>`, 'M5')}
        <div class="tag-cloud">${it.tags.map((n) => tagChip(n)).join('')}${it.plainTags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </section>
      <section class="section">
        ${sectionHead('컬렉션', '', 'M5')}
        ${it.collections
          .map((path) => `<div class="collection-path">${icon('folder', 'sm')}${path.map(esc).join(`<span class="sep">›</span>`)}</div>`)
          .join('')}
      </section>
      <section class="section">
        ${sectionHead('파일')}
        <dl class="kv">${it.file.map(([k, v]) => `<dt>${k}</dt><dd class="ellipsis">${esc(v)}</dd>`).join('')}
          <dt>SHA-256</dt><dd class="row gap-6"><span class="mono c-secondary">${it.sha}</span><span class="icon-btn sm" title="전체 해시 복사">${icon('copy', 'sm')}</span></dd>
        </dl>
      </section>
    </div>`;
  }

  function libraryWindow(opts = {}) {
    return M.windowShell({
      tabs: M.standardTabs('library'),
      sidebar: librarySidebar(opts.sidebar),
      main: libraryHeader(opts.header) + libraryTable(opts.table),
      inspector: inspector(),
      overlays: opts.overlays || '',
    });
  }

  // ── Library: empty + drop overlay ──────────────────────────────────────────
  function emptyMain() {
    return `${libraryHeader({ title: '내 라이브러리', count: '', inspectorOn: false, empty: true })}
      <div class="empty-state">
        <div class="glyph">${icon('library-big', 'xl')}</div>
        <h1>아직 자료가 없습니다</h1>
        <p>PDF나 동영상을 이 창에 끌어다 놓거나 가져올 파일을 선택하세요. 원본은 그대로 두고 라이브러리에 사본을 만듭니다.</p>
        <div class="actions">
          <div class="btn primary large">파일 가져오기…</div>
          <div class="btn large">외부 파일 연결…</div>
        </div>
        <div class="hints">
          <div class="row"><span>파일 가져오기</span>${kbd('⌘', 'O')}<span style="width:12px"></span><span>명령 팔레트</span>${kbd('⌘', 'K')}</div>
          <div class="row">PDF와 MP4 · MOV · WebM 동영상을 지원합니다.</div>
        </div>
      </div>`;
  }

  function dropOverlay() {
    return `<div class="drop-overlay" role="dialog" aria-label="파일 놓기">
      <div class="frame"></div>
      <div class="drop-panel">
        <div class="glyph">${icon('download', 'xl')}</div>
        <h1>놓으면 라이브러리로 가져옵니다</h1>
        <div class="files">파일 3개 · PDF 2개, 동영상 1개</div>
        <div class="drop-modes">
          <div class="drop-mode is-on">${icon('copy')}<span class="dm-title">사본으로 가져오기</span>
            <span class="dm-text">라이브러리 폴더에 복사합니다. 원본은 그대로 둡니다.</span></div>
          <div class="drop-mode is-off">${icon('link')}<span class="dm-title">${kbd('⌥')}&nbsp; 누른 채 놓기</span>
            <span class="dm-text">복사하지 않고 원래 위치의 파일에 연결합니다.</span></div>
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
    const fh = (cls = '') => (find ? `<span class="find-hit ${cls}">증폭</span>` : '증폭');
    switch (n) {
      case 40:
        return `${running}${para('a', 'no-indent')}${para('b')}${plainFigure(170, '그림 6-2')}${para('c')}${para('d')}${para('f')}<div class="folio">40</div>`;
      case 41:
        return `${running}${para('e', 'no-indent')}<h3>6.2 신호 ${fh()}</h3>${para('c')}${para('a')}${plainFigure(150, '그림 6-3')}${para('b')}<p>이 과정은 짧은 시간 안에 끝나며, 신호 분자가 사라지면 수용체도 원래 상태로 돌아간다.</p><div class="folio">41</div>`;
      case 42:
        return `${running}
        <h4>연쇄 반응과 ${fh('current')} 배율</h4>
        <p>세포 밖의 신호 분자 하나가 수용체에 결합하면 세포 안에서는 여러 단계의 효소 반응이 차례로 일어난다. 각 단계에서 활성화된 분자는 다음 단계의 분자를 여러 개 활성화하므로, 처음의 작은 신호는 단계를 거칠수록 커진다.</p>
        <p><span class="hl" ${find ? 'data-ms="M9"' : ''}>하나의 활성 수용체는 결합해 있는 동안 수백 개의 G 단백질을 활성화할 수 있고, 활성화된 아데닐산 고리화효소 하나는 1초에 수천 개의 cAMP를 만든다.</span> 단계마다 곱해지는 이 배율 덕분에 호르몬 분자 몇 개만으로도 세포 전체의 대사가 바뀐다.</p>
        <figure class="fig">${cascadeFigure()}
          <figcaption><b>그림 6-4</b> 신호 ${fh()} 단계. 원의 수는 각 단계에서 활성화되는 분자의 상대적인 양을, 화살표의 굵기는 신호의 세기를 나타낸다.</figcaption>
        </figure>
        <p>전체 ${fh()} 배율은 각 단계 배율의 곱으로 근사할 수 있다. 예를 들어 수용체 하나가 G 단백질 100개를 활성화하고, 고리화효소 하나가 cAMP 100개를 만든다면 이 두 단계만으로 신호는 만 배가 된다. 실제 세포에서는 신호를 끄는 반응이 동시에 일어나므로 배율은 이보다 작다.</p>
        <p>신호의 세기는 증폭뿐 아니라 각 분자가 활성 상태로 머무는 시간에도 달려 있다. G 단백질의 GTP 가수분해 속도가 느릴수록 한 번의 자극이 더 오래 지속된다.</p>
        <div class="box"><b>핵심 정리</b><ul><li>연쇄 반응의 각 단계는 신호를 곱으로 키운다.</li><li>신호를 끄는 반응의 속도가 실제 배율을 결정한다.</li></ul></div>
        <div class="folio">42</div>`;
      case 43:
        return `${running}${para('f', 'no-indent')}${para('e')}${plainFigure(190, '그림 6-5')}${para('a')}${para('c')}${para('b')}<div class="folio">43</div>`;
      default:
        return `${running}<h4>2차 전령의 역할</h4>${para('e', 'no-indent')}${para('f')}${para('d')}${para('a')}${para('c')}${para('b')}<div class="folio">${n}</div>`;
    }
  }

  function thumbs() {
    return `<div class="thumbs"><div class="thumbs-inner" style="transform:translateY(-104px)">${[40, 41, 42, 43, 44]
      .map((n) => `<div class="thumb ${n === 42 ? 'is-current' : ''}"><div class="thumb-page"><div class="pdf-page">${pageBody(n, { find: false })}</div></div><span class="lbl">${n}</span></div>`)
      .join('')}</div></div>`;
  }

  function outline() {
    return `<div class="outline" role="tree">${D.outline
      .map((o) => {
        const label = esc(o.t);
        const cls = ['nav-row', o.current ? 'is-selected' : ''].join(' ');
        const disc = o.lvl === 0 ? `<span class="disclosure">${icon(o.open ? 'chevron-down' : 'chevron-right', 'xs')}</span>` : '';
        return `<div class="${cls}" style="--indent:${o.lvl}">${disc}<span class="label ellipsis">${label}</span><span class="page">${o.p}</span></div>`;
      })
      .join('')}</div>`;
  }

  function pdfSidebar(nav) {
    const seg = (id, label, ms) => `<span class="seg ${nav === id ? 'is-on' : ''}" ${ms ? `data-ms="${ms}"` : ''}>${label}</span>`;
    const search =
      nav === 'outline'
        ? `<div class="nav-search"><div class="field small">${icon('search', 'sm')}<span class="placeholder">목차에서 찾기</span></div></div>`
        : '';
    return `<div class="reader-nav-head">
        <div class="segmented fill">${seg('thumbs', '썸네일', 'M7')}${seg('outline', '목차', 'M7')}${seg('notes', '필기', 'M9')}</div>
      </div>${search}
      ${nav === 'outline' ? outline() : thumbs()}`;
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

  function pdfPages() {
    return `<div class="pdf-scroll" style="top:-1083px">
      <div class="pdf-page" aria-label="41쪽">${pageBody(41)}</div>
      <div class="pdf-page" aria-label="42쪽">${pageBody(42)}
        <span class="margin-note" style="left:716px;top:186px" data-ms="M9" title="노트">${icon('sticky-note')}</span>
      </div>
    </div>`;
  }

  function zoomMenu() {
    const mi = (label, { check, shortcut, active, disabled } = {}) =>
      `<div class="mi ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}"><span class="check">${check ? icon('check', 'sm') : ''}</span><span>${label}</span>${shortcut ? `<span class="shortcut">${shortcut}</span>` : ''}</div>`;
    return `<div class="menu" data-anchor="zoom-btn" style="width:232px" role="menu">
      ${mi('자동 맞춤')}${mi('폭에 맞춤')}${mi('쪽에 맞춤')}${mi('실제 크기', { shortcut: '⌘0' })}
      <div class="msep"></div>
      ${mi('75%')}${mi('100%', { check: true })}${mi('125%', { active: true })}${mi('150%')}${mi('200%')}
      <div class="msep"></div>
      ${mi('확대', { shortcut: '⌘+' })}${mi('축소', { shortcut: '⌘−' })}
    </div>`;
  }

  function viewMenu() {
    const mi = (label, { check, shortcut, active } = {}) =>
      `<div class="mi ${active ? 'is-active' : ''}"><span class="check">${check ? icon('check', 'sm') : ''}</span><span>${label}</span>${shortcut ? `<span class="shortcut">${shortcut}</span>` : ''}</div>`;
    return `<div class="menu" data-anchor="view-btn" data-align="end" style="width:220px" role="menu">
      <div class="mhead">스크롤</div>${mi('세로로 이어서', { check: true })}${mi('가로로 이어서')}${mi('한 쪽씩')}
      <div class="msep"></div>
      <div class="mhead">펼침</div>${mi('펼치지 않음', { check: true })}${mi('홀수 쪽부터')}${mi('짝수 쪽부터')}
      <div class="msep"></div>
      <div class="mhead">쪽 색</div>${mi('앱 테마 따르기')}${mi('원본')}${mi('세피아', { check: true })}${mi('어둡게', { active: true })}
      <div class="msep"></div>
      ${mi('시계 방향으로 회전', { shortcut: '⌘R' })}
    </div>`;
  }

  function pdfToolbar({ menu }) {
    return `<div class="reader-toolbar">
      <div class="group" data-ms="M7">
        <span class="icon-btn is-disabled" title="뒤로 ⌘[">${icon('arrow-left')}</span>
        <span class="icon-btn" title="앞으로 ⌘]">${icon('arrow-right')}</span>
      </div>
      <span class="toolbar-sep"></span>
      <div class="page-field" data-ms="M7"><div class="field">42</div><span class="num">/ 68</span></div>
      <span class="spacer"></span>
      <div class="group" data-ms="M7">
        <span class="icon-btn" title="축소 ⌘−">${icon('zoom-out')}</span>
        <span class="zoom-btn ${menu === 'zoom' ? 'is-on' : ''}" id="zoom-btn" title="확대 비율">100%${icon('chevron-down', 'xs')}</span>
        <span class="icon-btn" title="확대 ⌘+">${icon('zoom-in')}</span>
      </div>
      <span class="spacer"></span>
      <div class="group" data-ms="M9">
        <span class="icon-btn" title="하이라이트">${icon('highlighter')}</span>
        <span class="icon-btn" title="밑줄">${icon('underline')}</span>
        <span class="icon-btn" title="노트">${icon('sticky-note')}</span>
        <span class="icon-btn" title="펜">${icon('pen-line')}</span>
        <span class="icon-btn" title="지우개">${icon('eraser')}</span>
        <span class="icon-btn with-caret" title="필기 색 · 노랑"><span class="chip" style="padding:0;height:auto;background:none"><span class="dot" style="background:var(--tag-1);width:12px;height:12px"></span></span>${icon('chevron-down', 'xs')}</span>
      </div>
      <span class="toolbar-sep"></span>
      <span class="icon-btn ${menu === 'zoom' ? '' : 'is-on'}" title="찾기 ⌘F">${icon('search')}</span>
      <span class="icon-btn ${menu === 'view' ? 'is-on' : ''}" id="view-btn" title="보기 옵션">${icon('book-open')}</span>
    </div>`;
  }

  function findBar() {
    return `<div class="find-bar" role="search" data-ms="M7">
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
    const main = `${pdfToolbar({ menu })}
      <div class="reader-body"><div class="pdf-stage">${pdfPages()}${menu ? '' : findBar()}</div></div>
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

  function videoSidebar() {
    const cues = D.cues
      .map(([ts, tx, state], i) => {
        const cur = state === 'current';
        const past = !cur && i < D.cues.findIndex((c) => c[2] === 'current');
        const text = esc(tx).replace('증폭', '<mark>증폭</mark>');
        return `<div class="cue ${cur ? 'is-current' : ''} ${past ? 'is-past' : ''}"><span class="ts">${ts}</span><span class="tx">${text}</span></div>`;
      })
      .join('');
    return `<div class="reader-nav-head">
        <div class="segmented fill"><span class="seg is-on" data-ms="M8">대본</span><span class="seg" data-ms="M9">시간 메모</span></div>
      </div>
      <div class="nav-search"><div class="field small">${icon('search', 'sm')}<span class="value">증폭</span><span class="spacer"></span><span class="c-tertiary num">2개</span></div></div>
      <div class="transcript" style="padding-top:2px">${cues}</div>
      <div class="transcript-foot"><span class="switch is-on"></span><span>현재 위치 따라가기</span><span class="spacer"></span><span class="ellipsis c-tertiary">lecture04.ko.srt</span></div>`;
  }

  function videoControls() {
    const played = 35.2;
    const marks = D.memos.map((m) => `<span class="memo-mark" style="left:${m.at * 100}%;background:${tagHex(m.color)}" data-ms="M9"></span>`).join('');
    return `<div class="video-controls">
      <div class="scrubber" data-ms="M8"><div class="track"><span class="buffered" style="width:58%"></span><span class="played" style="width:${played}%"></span>${marks}<span class="knob" style="left:${played}%"></span></div></div>
      <div class="control-row">
        <span class="icon-btn" title="10초 뒤로 J">${icon('rotate-ccw')}</span>
        <span class="icon-btn" title="재생 K / 스페이스" style="color:var(--text-primary)">${icon('play', 'lg')}</span>
        <span class="icon-btn" title="10초 앞으로 L">${icon('rotate-cw')}</span>
        <span class="time"><b>18:20</b> / 52:10</span>
        <span class="spacer"></span>
        <span class="speed-btn" title="재생 속도" data-ms="M8">1.25×</span>
        <span class="icon-btn is-on" title="자막 켜기/끄기 C">${icon('captions')}</span>
        <div class="volume"><span class="icon-btn" title="음소거 M">${icon('volume-2')}</span><span class="vtrack"><i></i></span></div>
        <span class="icon-btn" title="전체 화면 F">${icon('maximize')}</span>
      </div>
    </div>`;
  }

  function videoMain({ codec = false } = {}) {
    const head = `<div class="reader-toolbar">
      <span class="t-headline ellipsis media-title">${codec ? '수용체 탈감작 세미나 녹화' : '강의 04 · 세포 신호'}</span>
      <span class="c-tertiary t-footnote ellipsis">${codec ? '정민호 · 외부 연결' : '윤재하 · 2025 · 52분'}</span>
      <span class="spacer"></span>
      ${codec ? '' : `<span class="btn small plain has-icon has-menu" title="자막 선택" data-ms="M8">${icon('captions', 'sm')}한국어${icon('chevron-down', 'xs')}</span>
      <span class="btn small plain has-icon" data-ms="M9" title="현재 시간에 메모 ⇧⌘M">${icon('message-square-plus', 'sm')}시간 메모</span>`}
      <span class="icon-btn" title="더 보기">${icon('ellipsis')}</span>
    </div>`;
    if (codec) {
      return `${head}<div class="video-stage">
        <div class="codec-notice" role="alert">
          <div class="glyph">${icon('video-off', 'xl')}</div>
          <h2>이 동영상은 재생할 수 없습니다</h2>
          <p>Learn이 쓰는 재생 엔진이 이 파일의 형식을 지원하지 않습니다. MP4(H.264/AAC)로 변환한 파일을 가져오면 재생할 수 있습니다. 원본 파일은 그대로 보관됩니다.</p>
          <div class="file mono">seminar-0915.avi · 1.3 GB</div>
          <div class="actions"><div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div><div class="btn has-icon">${icon('external-link')}기본 앱으로 열기</div></div>
        </div>
      </div>`;
    }
    return `${head}<div class="video-stage"><div class="video-frame">${lectureSlide()}<div class="subtitle" data-ms="M8">그래서 이 단계에서 신호가 수백 배로 증폭됩니다.</div></div></div>${videoControls()}`;
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
    return M.windowShell({ tabs: M.standardTabs('video'), sidebar: videoSidebar(), sidebarWidth: 320, main: videoMain() });
  }

  // ── Command palette ────────────────────────────────────────────────────────
  function palette() {
    const mark = (s) => esc(s).replace('신호', '<mark>신호</mark>');
    const item = (ic, title, meta, active) =>
      `<div class="p-item ${active ? 'is-active' : ''}" role="option" aria-selected="${!!active}">${icon(ic)}<span class="p-title ellipsis">${mark(title)}</span><span class="p-meta">${meta}</span></div>`;
    return `<div class="scrim" style="opacity:0.55"></div>
    <div class="palette" role="dialog" aria-label="명령 팔레트">
      <div class="p-input">${icon('search')}<span>신호</span><span class="caret"></span><span class="p-scope">${kbd('esc')}</span></div>
      <div class="p-list" role="listbox">
        <div class="p-group">자료</div>
        ${item('file-text', '분자생물학 6장 · 신호 전달', `분자생물학 · 42쪽 ${kbd('↩')}`, true)}
        ${item('clapperboard', '강의 04 · 세포 신호', '분자생물학 · 18:20')}
        ${item('file-text', '신호 증폭의 정량 모델', '분자생물학')}
        ${item('file-text', '세포 신호 그림 모음', '분자생물학')}
        <div class="p-group">컬렉션</div>
        ${item('folder', '6장 · 신호 전달', '분자생물학 안 · 14개')}
        <div class="p-group">명령</div>
        ${item('list-filter', '라이브러리에서 “신호” 검색', kbd('⌘', 'F'))}
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

  // ── Settings sheet ─────────────────────────────────────────────────────────
  function themePreview(kind) {
    const L = { side: '#eef1f3', main: '#ffffff', line: '#d4d8dc' };
    const Dk = { side: '#1f2123', main: '#181a1b', line: '#3a3d40' };
    const pane = (c, clip = '') =>
      `<div class="pv" style="${clip}"><div class="pv-side" style="background:${c.side}"><i style="background:var(--accent);width:80%"></i><i style="background:${c.line};width:60%"></i><i style="background:${c.line};width:70%"></i></div>
       <div class="pv-main" style="background:${c.main}"><i style="background:${c.line};width:90%"></i><i style="background:${c.line};width:70%"></i><i style="background:${c.line};width:80%"></i><i style="background:${c.line};width:50%"></i></div></div>`;
    const body = kind === 'system' ? pane(L, 'clip-path:inset(0 50% 0 0)') + pane(Dk, 'clip-path:inset(0 0 0 50%)') : pane(kind === 'dark' ? Dk : L);
    return `<div class="preview">${body}<span class="lights"><b></b><b></b><b></b></span></div>`;
  }

  function settingsSheet() {
    return `<div class="scrim"></div>
    <div class="dialog settings" role="dialog" aria-label="설정">
      <div class="s-head"><h2>설정</h2><span class="spacer"></span><span class="icon-btn" title="닫기 esc">${icon('x')}</span></div>
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
              <span class="fr-label">밀도<span class="hint">목록과 표의 행 높이</span></span>
              <div class="segmented"><span class="seg">촘촘하게</span><span class="seg is-on">보통</span><span class="seg">여유 있게</span></div>
            </div>
            <div class="form-row">
              <span class="fr-label">글자 크기<span class="hint">앱 전체 글자 크기. 자료 본문은 리더에서 따로 확대합니다.</span></span>
              <div class="segmented" role="radiogroup" aria-label="글자 크기"><span class="seg" style="font-size:11px" title="작게" aria-label="작게">가</span><span class="seg is-on" style="font-size:13px" title="기본" aria-label="기본">가</span><span class="seg" style="font-size:15px" title="크게" aria-label="크게">가</span><span class="seg" style="font-size:17px" title="아주 크게" aria-label="아주 크게">가</span></div>
            </div>
          </div>
        </div>
        <div>
          <div class="group-label">라이브러리</div>
          <div class="form-group">
            <div class="form-row stacked">
              <span class="fr-label">위치<span class="hint">자료 사본과 데이터베이스가 있는 폴더입니다. 다른 폴더를 고르면 Learn을 다시 시작하고 그 폴더의 라이브러리를 엽니다.</span></span>
              <div class="path-box">${icon('folder', 'sm')}<span class="ellipsis">~/Library/Application Support/Learn/Library</span></div>
              <div class="row gap-8"><div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div><div class="btn">다른 폴더 선택…</div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="s-foot"><span class="t-footnote c-tertiary">변경 사항은 바로 적용됩니다.</span><span class="spacer"></span><div class="btn primary">완료</div></div>
    </div>`;
  }

  // ── Dialog scenes ──────────────────────────────────────────────────────────
  function importToast() {
    return `<div class="toasts" role="status">
      <div class="toast">
        <span class="spinner" aria-hidden="true"></span>
        <div><div class="t-title">가져오는 중 · <span class="num">7 / 12</span></div><div class="t-body ellipsis">강의 05 · 2차 전령.mp4</div></div>
        <div class="t-actions"><div class="btn small">취소</div></div>
        <div class="t-progress"><span class="progress wide"><i style="width:58%"></i></span><span class="num t-footnote c-secondary">58%</span></div>
      </div>
    </div>`;
  }

  function duplicateDialog() {
    return `<div class="scrim"></div>
    <div class="dialog" role="alertdialog" aria-label="중복 파일">
      <div class="d-body">
        <div class="d-title"><span class="badge-icon">${icon('copy')}</span><div><h2>이미 라이브러리에 있는 파일입니다</h2></div></div>
        <p class="d-text"><b>molbio_ch06_signaling.pdf</b>는 아래 자료와 내용이 같습니다(SHA-256&nbsp;일치). 어느 쪽을 골라도 원본 파일은 지우지 않습니다.</p>
        <div class="card item-card"><span class="thumb">${icon('file-text')}</span>
          <div style="min-width:0"><div class="t-headline ellipsis">분자생물학 6장 · 신호 전달</div><div class="t-footnote c-secondary ellipsis">분자생물학 · 4.2 MB · 2026. 10. 20. 추가</div></div></div>
        <label class="checkbox t-footnote"><span class="box is-on">${icon('check')}</span>남은 중복 파일 2개에도 같은 선택 적용</label>
      </div>
      <div class="d-foot">
        <div class="btn plain" style="padding:0 8px;color:var(--accent-text)">기존 자료 열기</div>
        <span class="spacer"></span>
        <div class="btn">새 자료로 추가</div>
        <div class="btn primary">건너뛰기</div>
      </div>
    </div>`;
  }

  function backupDialog() {
    return `<div class="scrim"></div>
    <div class="dialog" role="dialog" aria-label="백업 완료">
      <div class="d-body">
        <div class="d-title"><span class="badge-icon success">${icon('circle-check')}</span><div><h2>백업을 만들었습니다</h2><div class="t-footnote c-secondary" style="margin-top:2px">2026. 10. 20. 오후 9:41 · 38초 걸림</div></div></div>
        <div class="card" style="padding:12px 14px">
          <dl class="kv" style="grid-template-columns:max-content minmax(0,1fr)">
            <dt>자료</dt><dd><span class="num">128</span>개 · 필기와 태그 포함</dd>
            <dt>파일</dt><dd><span class="num">121</span>개 · 2.4 GB · 해시 모두 확인</dd>
            <dt>위치</dt><dd class="ellipsis" style="font:var(--type-mono);color:var(--text-secondary)" title="~/Documents/Learn 백업/2026-10-20.learnbackup">~/Documents/Learn 백업/2026-10-20.learnbackup</dd>
          </dl>
        </div>
        <div class="row gap-8 t-footnote c-secondary" style="align-items:flex-start">${icon('info', 'sm')}<span>외부 연결 자료 7개는 파일 없이 경로만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.</span></div>
      </div>
      <div class="d-foot"><div class="btn has-icon">${icon('folder-search')}Finder에서 보기</div><span class="spacer"></span><div class="btn primary">완료</div></div>
    </div>`;
  }

  function recoverySheet() {
    const ci = (ic, cls, title, text, meta, action) =>
      `<div class="check-item"><span class="status-dot ${cls}">${icon(ic)}</span><div><div class="ci-title">${title}</div><div class="ci-text">${text}</div>${meta ? `<div class="ci-meta">${meta}</div>` : ''}</div><div class="ci-action">${action}</div></div>`;
    return `<div class="scrim"></div>
    <div class="dialog wide" role="dialog" aria-label="라이브러리 점검">
      <div class="d-body" style="padding-bottom:12px">
        <div class="d-title" style="align-items:flex-start"><span class="badge-icon warning">${icon('stethoscope')}</span><div><h2 style="margin-top:5px">라이브러리 점검</h2>
          <p class="d-text" style="margin-top:4px">지난번에 Learn이 정상적으로 종료되지 않았습니다. 라이브러리를 확인한 결과입니다. 자동으로 지운 것은 없습니다.</p></div></div>
      </div>
      <div class="card checklist" style="margin:0 20px">
        ${ci('circle-check', 'c-success', '데이터베이스', '무결성 검사를 통과했습니다. 자료 128개와 필기가 모두 그대로입니다.', '', '')}
        ${ci('triangle-alert', 'c-warning', '끝나지 않은 가져오기 2건', '가져오는 도중 종료된 임시 파일입니다. 라이브러리에는 추가되지 않았습니다.', 'staging/ · 412 MB', '<div class="btn small">임시 파일 정리</div>')}
        ${ci('triangle-alert', 'c-warning', '원본을 찾을 수 없는 외부 연결 1개', 'Calcium Signaling Revisited — 파일을 옮겼다면 새 위치를 지정하세요.', '~/Downloads/papers/calcium-signaling.pdf', '<div class="btn small">다시 연결…</div>')}
        ${ci('info', 'c-secondary', '격리된 손상 파일 1개', '해시가 맞지 않아 따로 옮겨 둔 사본입니다. 확인한 뒤 직접 지울 수 있습니다.', 'staging/corrupt-9c417a2e…', '<div class="btn small has-icon">Finder에서 보기</div>')}
      </div>
      <div class="d-foot" style="padding-top:16px"><span class="t-footnote c-tertiary">점검은 메뉴 ‘파일 › 라이브러리 점검’에서 다시 할 수 있습니다.</span><span class="spacer"></span><div class="btn primary">완료</div></div>
    </div>`;
  }

  // ── Component and token board ──────────────────────────────────────────────
  function componentsBoard() {
    const part = params.get('part') === '2' ? 2 : 1;
    const row = (label, html) => `<div class="state-row"><span class="lbl">${label}</span>${html}</div>`;
    const header = (title, sub) => `<header><h1>${title}</h1><p>${sub}</p></header>`;
    if (part === 1) {
      const btns = (cls, label, ic) =>
        ['', 'is-hover', 'is-pressed', 'is-focus', 'is-disabled']
          .map((st) => `<span class="btn ${cls} ${st} ${ic ? 'has-icon' : ''}">${ic ? icon(ic) : ''}${label}</span>`)
          .join('');
      return `<div class="board">${header('컴포넌트 상태', '기본 · 호버 · 누름 · 키보드 포커스 · 비활성. 모든 값은 tokens.css. 포커스 링은 2px --focus, 1px 띄움.')}
        <div class="board-grid">
          <section class="panel" style="grid-column:span 2">
            <h3>버튼</h3>
            ${row('기본', btns('primary', '열기'))}
            ${row('보조', btns('', '가져오기', 'plus'))}
            ${row('평면', btns('plain', '건너뛰기'))}
            ${row('아이콘', ['', 'is-hover', 'is-on', 'is-accent', 'is-disabled'].map((st) => `<span class="icon-btn ${st}">${icon('panel-left')}</span>`).join(''))}
            ${row('작게', `<span class="btn small">취소</span><span class="btn small primary">다시 연결…</span><span class="btn small plain has-icon has-menu">${icon('captions', 'sm')}한국어${icon('chevron-down', 'xs')}</span>`)}
          </section>
          <section class="panel">
            <h3>메뉴</h3>
            <div class="menu static-menu" role="menu">
              <div class="mhead">정렬</div>
              <div class="mi"><span class="check">${icon('check', 'sm')}</span><span>추가일</span></div>
              <div class="mi is-active"><span class="check"></span><span>제목</span></div>
              <div class="mi is-disabled"><span class="check"></span><span>진행 (자료를 연 뒤)</span></div>
              <div class="msep"></div>
              <div class="mi"><span class="check"></span><span>Finder에서 보기</span><span class="shortcut">⇧⌘R</span></div>
              <div class="mi"><span class="check"></span><span>휴지통으로 이동</span><span class="shortcut">⌘⌫</span></div>
            </div>
          </section>
          <section class="panel">
            <h3>입력</h3>
            ${row('기본', `<div class="field" style="width:220px">${icon('search', 'sm')}<span class="placeholder">제목, 저자, 태그 검색</span></div>`)}
            ${row('포커스', `<div class="field is-focus" style="width:220px">${icon('search', 'sm')}<span class="value">신호</span><span class="caret"></span><span class="spacer"></span>${icon('circle-x', 'sm')}</div>`)}
            ${row('비활성', `<div class="field is-disabled" style="width:220px;opacity:.5">${icon('search', 'sm')}<span class="placeholder">검색할 자료가 없습니다</span></div>`)}
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
            ${navRow({ label: '드롭 대상 (⌘ 이동)', ic: 'folder', count: 9, cls: 'is-drop-target' })}
          </section>
          <section class="panel" style="padding-left:8px;padding-right:8px">
            <h3 style="padding-left:8px">표 행</h3>
            <div class="table" style="--cols:minmax(0,1fr) 48px 96px"><div class="table-body" style="padding-top:0">
              ${[
                ['기본', {}],
                ['호버', { hover: true }],
                ['선택 · 포커스 없음', { selected: true }],
                ['선택 · 포커스', { selected: true, focused: true }],
              ]
                .map(([label, st], i) =>
                  `<div class="table-row ${st.hover ? 'is-hover' : ''} ${st.selected ? 'is-selected' : ''} ${st.focused ? 'is-focused' : ''}" ${st.hover || st.selected ? '' : 'style="background:transparent"'}><div class="td">${icon('file-text')}<span class="title ellipsis">${label}</span><span class="tag-dots"><i style="background:var(--tag-1)"></i></span></div><div class="td num">2024</div><div class="td">${progressCell(i === 3 ? 62 : i === 1 ? 100 : 35)}</div></div>`,
                )
                .join('')}
              <div class="table-row is-missing" style="background:transparent"><div class="td">${icon('file-text')}<span class="title ellipsis">파일 없음</span><span class="inline-flag c-warning">${icon('triangle-alert', 'sm')}</span></div><div class="td num">2024</div><div class="td">${progressCell(null)}</div></div>
            </div></div>
          </section>
        </div>
        <div class="board-grid">
          <section class="panel">
            <h3>칩 · 배지 · 진행</h3>
            <div class="tag-cloud">${[1, 2, 4, 5].map((n) => tagChip(n)).join('')}<span class="chip">수용체</span><span class="chip is-on">시험 범위</span><span class="chip is-dim">회귀분석</span><span class="chip add">${icon('plus', 'sm')}태그 추가</span></div>
            ${row('진행', `<span class="progress" style="width:120px"><i style="width:62%"></i></span><span class="spinner"></span>${progressCell(100)}`)}
            ${row('키', `${kbd('⌘', 'K')}${kbd('⇧', '⌘', 'N')}${kbd('⌥')}${kbd('esc')}<span class="shortcut">⌃⌘S</span>`)}
            ${row('의미', `<span class="inline-flag c-success">${icon('circle-check', 'sm')}완료</span><span class="inline-flag c-warning">${icon('triangle-alert', 'sm')}파일 없음</span><span class="inline-flag c-danger">${icon('circle-alert', 'sm')}저장 실패</span>`)}
          </section>
          <div style="display:flex;flex-direction:column;gap:12px">
          <div class="toast static"><span class="spinner"></span><div><div class="t-title">가져오는 중 · <span class="num">7 / 12</span></div><div class="t-body ellipsis">강의 05 · 2차 전령.mp4</div></div><div class="t-actions"><div class="btn small">취소</div></div><div class="t-progress"><span class="progress wide"><i style="width:58%"></i></span><span class="num t-footnote c-secondary">58%</span></div></div>
          <div class="toast static"><span class="c-success">${icon('circle-check')}</span><div><div class="t-title">12개 중 11개를 가져왔습니다</div><div class="t-body">1개는 이미 있는 자료라 건너뛰었습니다.</div></div><div class="t-actions"><div class="btn small plain" style="color:var(--accent-text)">보기</div></div></div>
          </div>
          <div class="toast static"><span class="c-danger">${icon('circle-alert')}</span><div><div class="t-title">필기를 저장하지 못했습니다</div><div class="t-body">디스크 공간이 부족합니다. 공간을 확보한 뒤 다시 시도하세요.</div></div><div class="t-actions"><div class="btn small">다시 시도</div></div></div>
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
          ${type('title2', '분자생물학 6장 · 신호 전달')}
          ${type('title3', '분자생물학 48개')}
          ${type('callout', 'PDF나 동영상을 이 창에 끌어다 놓으세요.')}
          ${type('body', '하나의 활성 수용체는 수백 개의 G 단백질을 활성화한다.')}
          ${type('headline', '가져오는 중 · 7 / 12')}
          ${type('paragraph', '외부 연결 자료 7개는 파일 없이 경로만 기록했습니다.')}
          ${type('footnote', '42 / 68쪽에서 멈춤 · 오늘 오전 9:24')}
          ${type('caption', '라이브러리 · 컬렉션 · 태그')}
          ${type('mono', '9c41 7a2e … 51d8 e07b')}
        </section>
        <section class="panel"><h3>간격 · 반경 · 그림자</h3>
          <div class="state-row">${[2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48].map((n) => `<span title="${n}" style="display:inline-block;width:${n}px;height:24px;background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)"></span>`).join('')}</div>
          <div class="state-row t-caption c-tertiary">2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 px</div>
          <div class="state-row" style="gap:16px">${['xs', 'sm', 'md', 'lg', 'xl'].map((r) => `<span style="display:grid;place-items:center;width:52px;height:40px;border-radius:var(--radius-${r});background:var(--fill-pressed);font:var(--type-caption);color:var(--text-secondary)">${r}</span>`).join('')}</div>
          <div class="state-row" style="gap:20px;padding:8px 4px 4px">${['e0', 'e1', 'e2'].map((e) => `<span style="display:grid;place-items:center;width:96px;height:56px;border-radius:var(--radius-lg);background:var(--bg-raised);box-shadow:var(--shadow-${e});font:var(--type-caption);color:var(--text-secondary)">${e}</span>`).join('')}</div>
          <div class="state-row">${row('행 높이', `<span class="t-footnote c-secondary num">24 촘촘하게 · 28 보통 · 32 여유 있게</span>`)}</div>
          <div class="state-row">${row('아이콘', `${icon('library-big')}${icon('folder')}${icon('file-text')}${icon('clapperboard')}${icon('search')}${icon('panel-left')}${icon('highlighter')}<span class="t-footnote c-secondary">lucide 16px · stroke 1.5</span>`)}</div>
        </section>
      </div>
    </div>`;
  }

  // ── Render entry ───────────────────────────────────────────────────────────
  const screens = {
    library: () => libraryWindow({}),
    'library-empty': () => {
      const drop = params.get('state') === 'drop';
      return M.windowShell({
        tabs: [{ title: '라이브러리', icon: 'library-big', home: true, active: true }],
        sidebar: librarySidebar({ empty: true, selected: 'all', focused: false }),
        main: emptyMain(),
        overlays: drop ? dropOverlay() : '',
      });
    },
    'reader-pdf': pdfWindow,
    'reader-video': () => videoWindow(),
    palette: () => libraryWindow({ table: { focused: false }, overlays: palette() }),
    settings: () => libraryWindow({ table: { focused: false }, overlays: settingsSheet() }),
    components: componentsBoard,
    dialogs: () => {
      const scene = params.get('scene') || 'duplicate';
      if (scene === 'codec') return videoWindow({ codec: true });
      const overlay = { duplicate: duplicateDialog() + importToast(), backup: backupDialog(), recovery: recoverySheet() }[scene];
      return libraryWindow({ table: { focused: false }, overlays: overlay });
    },
  };

  M.render = (name) => M.mount(screens[name]());
})();
