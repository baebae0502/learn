import { Copy, FileText, FolderSearch, LibraryBig, Link, Link2Off, PanelLeft, Search, TriangleAlert, VideoOff, X } from 'lucide-react';
import { Menu, MenuItem } from 'react-aria-components';
import { Button, IconButton, type ButtonVariant, type ForcedState } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { Notice } from '../ui/Notice';
import { readWindowParams } from '../ui/platform';
import { Segmented } from '../ui/Segmented';
import { Spinner } from '../ui/Spinner';
import { TOAST_ICON, TOAST_TONE, type ToastData } from '../ui/toasts';

const STATES: Array<{ name: string; force?: ForcedState[]; disabled?: boolean }> = [
  { name: '기본' },
  { name: '호버', force: ['hover'] },
  { name: '누름', force: ['pressed'] },
  { name: '포커스', force: ['focus'] },
  { name: '비활성', disabled: true },
];
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'plain', 'plain-accent', 'plain-danger'];
/** Disabled samples carry a reason like real call sites (M-2): a native tooltip on a box-less wrapper, no layout change. */
const REASON = '열린 자료가 없습니다.';
const noop = () => {};

function StaticToast({ data }: { data: ToastData }) {
  return (
    <div className="toast g-static" data-kind={data.kind}>
      <span className={`t-icon ${TOAST_TONE[data.kind]}`}>
        <Icon icon={TOAST_ICON[data.kind]} size="lg" />
      </span>
      <div className="t-text">
        <div className="t-title">{data.title}</div>
        {data.body && <div className="t-body">{data.body}</div>}
      </div>
      {/* Like <Toasts/>: only an error toast has a close button (C-6). */}
      {data.kind === 'error' && (
        <span className="icon-btn sm">
          <Icon icon={X} size="sm" />
        </span>
      )}
    </div>
  );
}

function Part1() {
  return (
    <>
      <section>
        <h2 className="g-title">버튼</h2>
        {VARIANTS.map((v) => (
          <div className="g-row" key={v}>
            <span className="g-label">{v}</span>
            {STATES.map((s) => (
              <Button
                key={s.name}
                variant={v}
                force={s.force}
                isDisabled={s.disabled}
                disabledReason={s.disabled ? REASON : undefined}
                testId={s.disabled ? `g-${v}-disabled` : undefined}
              >
                {v === 'primary' ? '가져오기' : s.name}
              </Button>
            ))}
          </div>
        ))}
        <div className="g-row">
          <span className="g-label">크기·아이콘</span>
          <Button size="small">완료</Button>
          <Button size="large" variant="primary">파일 가져오기…</Button>
          <Button icon={FolderSearch}>Finder에서 보기</Button>
        </div>
      </section>
      <section>
        <h2 className="g-title">아이콘 단추</h2>
        <div className="g-row">
          {[...STATES, { name: '켜짐', force: ['on'] as ForcedState[] }].map((s) => (
            <IconButton
              key={s.name}
              icon={PanelLeft}
              label={`사이드바 ${s.name}`}
              force={s.force}
              isDisabled={s.disabled}
              disabledReason={s.disabled ? REASON : undefined}
              testId={s.disabled ? 'g-icon-disabled' : undefined}
            />
          ))}
        </div>
        <h2 className="g-title">필드·실행기·키캡</h2>
        <div className="g-row">
          <span className="field launcher g-field">
            <Icon icon={Search} size="sm" />
            <span className="placeholder">검색 및 명령</span>
            <Kbd accelerator="CmdOrCtrl+K" />
          </span>
          <span className="field g-field" data-force="focus">
            <Icon icon={Search} size="sm" />
            <span>신호</span>
          </span>
        </div>
        <div className="g-row">
          <Kbd accelerator="Alt+CmdOrCtrl+O" />
          <Kbd accelerator="Ctrl+Cmd+S" />
          <Kbd accelerator="CmdOrCtrl+/" />
          <Kbd keys={['↑', '↓']} />
          <Kbd keys={['↩']} />
          <Kbd keys={['esc']} />
        </div>
      </section>
      <section>
        <h2 className="g-title">세그먼트</h2>
        {([undefined, ['focus'] as ForcedState[]] as const).map((force, i) => (
          <div className="g-row" key={i}>
            <Segmented aria-label="밀도" value="regular" onChange={noop} force={force} options={[{ value: 'compact', label: '촘촘하게' }, { value: 'regular', label: '보통' }, { value: 'comfortable', label: '여유 있게' }]} />
          </div>
        ))}
        <div className="g-row">
          <Segmented aria-label="글자 크기" value="13" onChange={noop} isDisabled options={[{ value: '12', label: '작게' }, { value: '13', label: '기본' }, { value: '14', label: '크게' }, { value: '15', label: '아주 크게' }]} />
        </div>
      </section>
      <section>
        <h2 className="g-title">웹 팝업 메뉴</h2>
        <Menu aria-label="가져오기" className="menu" style={{ width: 240 }} onAction={noop}>
          <MenuItem id="managed" className="mi" textValue="파일 가져오기…" data-force="active">
            <span className="check" />
            <span>파일 가져오기…</span>
            <span className="shortcut">⌘O</span>
          </MenuItem>
          <MenuItem id="linked" className="mi" textValue="외부 파일 연결…">
            <span className="check" />
            <span>외부 파일 연결…</span>
            <span className="shortcut">⌥⌘O</span>
          </MenuItem>
        </Menu>
      </section>
    </>
  );
}

function Part2() {
  return (
    <>
      <section>
        <h2 className="g-title">토스트·스피너·툴팁</h2>
        <StaticToast data={{ kind: 'success', title: '자료 3개를 가져왔습니다' }} />
        <StaticToast data={{ kind: 'error', title: '파일 1개를 가져오지 못했습니다', body: 'notes.txt: 지원하지 않는 형식입니다.' }} />
        <div className="g-row">
          <Spinner />
          <span className="tooltip">
            사이드바 보기/숨기기<span className="tooltip-shortcut">⌃⌘S</span>
          </span>
        </div>
      </section>
      <section>
        <h2 className="g-title">안내 타일</h2>
        <div className="g-row">
          <Notice icon={VideoOff} title="재생할 수 없습니다" />
          <Notice tone="warning" icon={Link2Off} title="원본 없음" />
          <Notice tone="accent" icon={LibraryBig} title="빈 라이브러리" />
        </div>
      </section>
      <section>
        <h2 className="g-title">사이드바 행</h2>
        <div className="g-list nav-list">
          {([['기본'], ['호버', 'hover'], ['선택(포커스 없음)', 'selected'], ['선택(포커스)', 'selected focused'], ['키보드 커서', 'cursor'], ['선택 + 커서', 'selected focused cursor']] as const).map(([name, force]) => (
            <div key={name} className="nav-row" data-force={force}>
              <Icon icon={LibraryBig} />
              <span className="label ellipsis">{name}</span>
              <span className="count num">12</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="g-title">표 행</h2>
        <div className="g-table">
          <div className="table-head">
            <div className="th">제목</div>
            <div className="th">종류</div>
            <div className="th end">크기</div>
            <div className="th">추가일</div>
          </div>
          <div className="table-body">
            {([['기본', undefined, false], ['줄무늬', undefined, false], ['호버', 'hover', false], ['파일 없음', undefined, true], ['키보드 커서', 'cursor', false]] as const).map(([name, force, missing]) => (
              <div key={name} className="table-row" data-force={force} data-missing={missing || undefined}>
                <div className="td">
                  <Icon icon={FileText} />
                  <span className="row-open">{name} · 분자생물학 6장</span>
                  {missing ? (
                    <span className="inline-flag c-warning">
                      <Icon icon={TriangleAlert} size="sm" />
                      파일 없음
                    </span>
                  ) : (
                    <Icon icon={Link} size="sm" className="c-tertiary" />
                  )}
                </div>
                <div className="td">PDF</div>
                <div className="td end num">4.2 MB</div>
                <div className="td num">2026. 10. 20.</div>
              </div>
            ))}
          </div>
        </div>
        <div className="g-row">
          <Icon icon={Copy} />
        </div>
      </section>
    </>
  );
}

/** Component state board (design-spec 10.8). Opened only by the visual tour: learn://app/index.html?window=gallery&part=1|2. */
export function Gallery() {
  const { part } = readWindowParams(location.search);
  return (
    <div className="gallery" data-testid="gallery">
      {part === 1 ? <Part1 /> : <Part2 />}
    </div>
  );
}
