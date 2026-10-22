import { useState } from 'react';
import { Bookmark, Copy, FileText, FolderSearch, LibraryBig, Link, Link2Off, PanelLeft, Plus, Search, TriangleAlert, VideoOff, X } from 'lucide-react';
import { t } from '../strings';
import { Button, IconButton, type ButtonVariant, type ForcedState } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { MENU_SEPARATOR, MenuButton, MenuList, type MenuEntry } from '../ui/MenuButton';
import { Notice } from '../ui/Notice';
import { readWindowParams } from '../ui/platform';
import { SearchField } from '../ui/SearchField';
import { Segmented } from '../ui/Segmented';
import { Spinner } from '../ui/Spinner';
import { ToastIcon, ToastLines, Toasts, showToast, type ToastData } from '../ui/toasts';
import { TooltipText } from '../ui/Tooltip';

// Sample copy on the board never reaches a user screen, so it stays outside strings/ (except shared words like 닫기).

const STATES: Array<{ name: string; force?: ForcedState[]; disabled?: boolean }> = [
  { name: '기본' },
  { name: '호버', force: ['hover'] },
  { name: '누름', force: ['pressed'] },
  { name: '포커스', force: ['focus'] },
  { name: '비활성', disabled: true },
];
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'plain', 'plain-accent', 'plain-danger'];
/** Disabled samples carry a reason like real call sites (I1): aria-disabled, tooltip + description, no layout change. */
const REASON = '열린 자료가 없습니다.';
const noop = () => {};

type ImportId = 'managed' | 'linked';
const IMPORT_MENU: readonly MenuEntry<ImportId>[] = [
  { id: 'managed', label: '파일 가져오기…', accelerator: 'CmdOrCtrl+O' },
  { id: 'linked', label: '외부 파일 연결…', accelerator: 'Alt+CmdOrCtrl+O' },
];

type SortId = 'added' | 'title' | 'progress' | 'ascending' | 'descending';
/** The sort menu of design-spec 7.3: a header, one checked choice per group, a disabled item, a separator. */
function sortMenu(sort: SortId, order: SortId, opts: { activeTitle?: boolean; testIds?: boolean } = {}): readonly MenuEntry<SortId>[] {
  const tid = (id: SortId) => (opts.testIds ? `g3-mi-${id}` : undefined);
  return [
    {
      header: '정렬 기준',
      items: [
        { id: 'added', label: '추가일', checked: sort === 'added', testId: tid('added') },
        { id: 'title', label: '제목', checked: sort === 'title', testId: tid('title'), force: opts.activeTitle ? ['active'] : undefined },
        { id: 'progress', label: '진행', checked: sort === 'progress', isDisabled: true, testId: tid('progress') },
      ],
    },
    MENU_SEPARATOR,
    {
      items: [
        { id: 'ascending', label: '오름차순', checked: order === 'ascending', testId: tid('ascending') },
        { id: 'descending', label: '내림차순', checked: order === 'descending', testId: tid('descending') },
      ],
    },
  ];
}

/** A toast as <Toasts/> draws it, in place: same icon, text and (error only, C-6) the real close button. */
function StaticToast({ data }: { data: ToastData }) {
  return (
    <div className="toast g-static" data-kind={data.kind}>
      <ToastIcon kind={data.kind} />
      <div className="t-text">
        <div className="t-title">{data.title}</div>
        {(data.lines?.length || data.body) && (
          <div className="t-desc">
            <ToastLines data={data} />
          </div>
        )}
      </div>
      {data.kind === 'error' && <IconButton icon={X} label={t.common.close} size="small" />}
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
          <Button size="large" variant="primary">
            파일 가져오기…
          </Button>
          <Button icon={FolderSearch}>Finder에서 보기</Button>
        </div>
        <div className="g-row">
          {/* Disabled with a reason and keyboard-focused: dimmed body, full-strength ring (design-spec 8.3). */}
          <span className="g-label">이유 있는 비활성</span>
          <Button variant="primary" force={['focus']} isDisabled disabledReason={REASON}>
            가져오기
          </Button>
          <Button force={['focus']} isDisabled disabledReason={REASON} testId="g-soft-focus">
            포커스
          </Button>
        </div>
        <div className="g-row">
          <span className="g-label">메뉴 단추</span>
          <MenuButton label="가져오기" icon={Plus} items={IMPORT_MENU} onAction={noop} />
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
          <IconButton icon={PanelLeft} label="사이드바 비활성 포커스" force={['focus']} isDisabled disabledReason={REASON} testId="g-soft-focus-icon" />
        </div>
        <h2 className="g-title">필드·실행기·키캡</h2>
        <div className="g-row">
          <span className="field launcher g-field">
            <Icon icon={Search} size="sm" />
            <span className="placeholder">검색 및 명령</span>
            <Kbd accelerator="CmdOrCtrl+K" />
          </span>
          <span className="field launcher g-field" data-force="focus">
            <Icon icon={Search} size="sm" />
            <span className="placeholder">검색 및 명령</span>
            <Kbd accelerator="CmdOrCtrl+K" />
          </span>
        </div>
        <div className="g-row">
          <SearchField aria-label="빠른 검색" placeholder="제목, 저자, 태그 검색" className="g-field" />
          <SearchField aria-label="빠른 검색" defaultValue="신호" className="g-field" force={['focus']} />
        </div>
        <div className="g-row">
          <SearchField aria-label="태그 필터" placeholder="태그 필터" size="small" className="g-field-small" />
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
            <Segmented
              aria-label="밀도"
              value="regular"
              onChange={noop}
              force={force}
              options={[
                { value: 'compact', label: '촘촘하게' },
                { value: 'regular', label: '보통' },
                { value: 'comfortable', label: '여유 있게' },
              ]}
            />
          </div>
        ))}
        <div className="g-row">
          <Segmented
            aria-label="글자 크기"
            value="13"
            onChange={noop}
            isDisabled
            options={[
              { value: '12', label: '작게' },
              { value: '13', label: '기본' },
              { value: '14', label: '크게' },
              { value: '15', label: '아주 크게' },
            ]}
          />
        </div>
      </section>
      <section>
        <h2 className="g-title">웹 팝업 메뉴</h2>
        <div className="g-row g-top">
          <MenuList aria-label="정렬" entries={sortMenu('added', 'descending', { activeTitle: true })} onAction={noop} />
          <MenuList aria-label="가져오기" entries={IMPORT_MENU} onAction={noop} />
        </div>
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
            <TooltipText label="사이드바 가리기" accelerator="Ctrl+Cmd+S" />
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
          {(
            [
              ['기본'],
              ['호버', 'hover'],
              ['선택(포커스 없음)', 'selected'],
              ['선택(포커스)', 'selected focused'],
              ['키보드 커서', 'cursor'],
              ['선택(포커스) + 커서: 링 없음', 'selected focused cursor'],
            ] as const
          ).map(([name, force]) => (
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
            {(
              [
                ['기본', undefined, false],
                ['줄무늬', undefined, false],
                ['호버', 'hover', false],
                ['파일 없음', undefined, true],
                ['키보드 커서', 'cursor', false],
              ] as const
            ).map(([name, force, missing]) => (
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
                    <span className="c-tertiary" title="외부 파일 연결">
                      <Icon icon={Link} size="sm" />
                    </span>
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

/** Interactive fixture for tests/e2e/components.spec.ts (not part of the visual tour). */
function Part3() {
  const [presses, setPresses] = useState(0);
  const [beforePresses, setBeforePresses] = useState(0);
  const [last, setLast] = useState('—');
  const [sort, setSort] = useState<SortId>('added');
  const [order, setOrder] = useState<SortId>('descending');
  const [density, setDensity] = useState<'compact' | 'regular' | 'comfortable'>('regular');
  const press = () => setPresses((n) => n + 1);
  const choose = (id: SortId) => {
    setLast(id);
    if (id === 'ascending' || id === 'descending') setOrder(id);
    else setSort(id);
  };
  return (
    <>
      <section>
        <h2 className="g-title">비활성 이유</h2>
        <div className="g-row">
          <Button testId="g3-before" onPress={() => setBeforePresses((n) => n + 1)}>
            확인
          </Button>
          <Button testId="g3-soft" isDisabled disabledReason={REASON} onPress={press}>
            내보내기
          </Button>
          <IconButton testId="g3-soft-icon" icon={PanelLeft} label="사이드바" accelerator="Ctrl+Cmd+S" isDisabled disabledReason={REASON} onPress={press} />
          <MenuButton
            testId="g3-soft-menu"
            label="정렬"
            items={sortMenu(sort, order)}
            onAction={(id) => {
              press();
              setLast(id);
            }}
            isDisabled
            disabledReason={REASON}
          />
        </div>
        <div className="g-row">
          <span className="g-label">누름(비활성 · 확인)</span>
          <output data-testid="g3-presses">{presses}</output>
          <output data-testid="g3-before-presses">{beforePresses}</output>
        </div>
      </section>
      <section>
        <h2 className="g-title">메뉴 단추</h2>
        <div className="g-row">
          <MenuButton testId="g3-menu" label="정렬" items={sortMenu(sort, order, { testIds: true })} onAction={choose} />
          <output data-testid="g3-last">{last}</output>
        </div>
      </section>
      <section>
        <h2 className="g-title">툴팁</h2>
        <div className="g-row">
          <Button testId="g3-tip-before">앞</Button>
          <IconButton testId="g3-tip" icon={Bookmark} label="책갈피" accelerator="CmdOrCtrl+B" />
        </div>
      </section>
      <section>
        <h2 className="g-title">세그먼트</h2>
        <div className="g-row">
          <Segmented<typeof density>
            aria-label="밀도"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact', label: '촘촘하게' },
              { value: 'regular', label: '보통' },
              { value: 'comfortable', label: '여유 있게' },
            ]}
          />
          <output data-testid="g3-seg-value">{density}</output>
        </div>
      </section>
      <section>
        <h2 className="g-title">검색 필드</h2>
        <div className="g-row">
          <SearchField aria-label="검색" defaultValue="신호" className="g-field" testId="g3-search" />
        </div>
      </section>
      <section>
        <h2 className="g-title">토스트</h2>
        <div className="g-row">
          <Button testId="g3-toast-success" onPress={() => showToast({ kind: 'success', title: '자료 3개를 가져왔습니다', testId: 'toast-success' })}>
            성공 토스트
          </Button>
          <Button
            testId="g3-toast-error"
            onPress={() => showToast({ kind: 'error', title: '파일 1개를 가져오지 못했습니다', body: 'notes.txt: 지원하지 않는 형식입니다.', testId: 'toast-error' })}
          >
            오류 토스트
          </Button>
          <Button testId="g3-toast-error-title" onPress={() => showToast({ kind: 'error', title: '필기를 저장하지 못했습니다', testId: 'toast-error-title' })}>
            제목만 있는 오류 토스트
          </Button>
        </div>
      </section>
      <Toasts />
    </>
  );
}

const PARTS = { 1: Part1, 2: Part2, 3: Part3 } as const;

/**
 * Component state board (design-spec 10.8): learn://app/index.html?window=gallery&part=1|2 for the visual tour,
 * part=3 for behaviour tests. Opened only by tests.
 */
export function Gallery() {
  const Part = PARTS[readWindowParams(location.search).part];
  return (
    <div className="gallery" data-testid="gallery">
      <Part />
    </div>
  );
}
