import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, TriangleAlert, Minus, Plus } from 'lucide-react';
import { FieldError, Input, Label, TextArea, TextField } from 'react-aria-components';
import type { ItemDetail, LibraryItem } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { revealInspector } from '../shell/useInspector';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { isComposingKey } from '../ui/ime';
import { currentPlatform } from '../ui/platform';
import { showToast } from '../ui/toasts';
import { leaveEditing, openEditSession } from './editGuard';
import { CREATOR_ROLES, FIELD_ORDER, draftOf, sameInfo, validateInfo, type CleanInfo, type CreatorDraft, type FieldErrors, type InfoDraft, type InfoTextField } from './editInfo';
import { takeFocusRequest } from './startEditing';

let rowSeq = 0;
const newRowKey = () => `row-${++rowSeq}`;
const fieldInput = (root: HTMLElement | null, field: InfoTextField) =>
  root?.querySelector<HTMLElement>(`[data-testid="editor-field"][data-field="${field}"] :is(input, textarea)`) ?? null;

/**
 * 정보 편집 (spec §5.3): the 정보 section as a form, in its place. It saves through library.updateMetadata, the whole
 * metadata object (the repository replaces it). While it is open it is the edit session (editGuard.ts): another row,
 * the reader, and — through main's flush (M/edit-flush.ts) — closing the window or quitting ask it first. No change
 * ends it, valid changes are saved first, invalid ones keep the item (the table selection comes back to it) with the
 * unsaved line and 버리기. No sheet.
 */
export function InfoEditor({ item, detail }: { item: LibraryItem; detail: ItemDetail }) {
  const e = t.inspector.editor;
  // What the edit started from: a refresh meanwhile (libraryChanged) does not move the base under the user's typing.
  const [initial] = useState(() => draftOf(item.title, detail.metadata, newRowKey));
  const [draft, setDraft] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  /** What the library holds as of now: the form the edit started from, then whatever was last saved (typing may go on during a write). */
  const baseRef = useRef(initial);
  useLayoutEffect(() => {
    draftRef.current = draft;
  });
  const check = useMemo(() => validateInfo(draft), [draft]);
  const errors: FieldErrors = showErrors && !check.ok ? check.errors : {};
  useEffect(() => {
    if (check.ok) setBlocked(false); // the line goes once nothing is marked
  }, [check.ok]);

  const set = (patch: Partial<InfoDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setCreator = (i: number, patch: Partial<CreatorDraft>) => setDraft((d) => ({ ...d, creators: d.creators.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const addCreator = () => {
    const row: CreatorDraft = { key: newRowKey(), name: '', role: 'author' };
    setDraft((d) => ({ ...d, creators: [...d.creators, row] }));
    setFocusRow(row.key);
  };
  const removeCreator = (i: number) => {
    const next = draft.creators[i + 1] ?? draft.creators[i - 1];
    setDraft((d) => ({ ...d, creators: d.creators.filter((_, j) => j !== i) }));
    setFocusRow(next?.key ?? 'add');
  };
  const moveCreator = (i: number, by: -1 | 1) => {
    const key = draft.creators[i]!.key;
    setDraft((d) => {
      const creators = [...d.creators];
      const [row] = creators.splice(i, 1);
      creators.splice(i + by, 0, row!);
      return { ...d, creators };
    });
    setFocusRow(key); // its arrow may now be the disabled end one: the focus stays on the row
  };
  useLayoutEffect(() => {
    if (focusRow === null) return;
    const root = rootRef.current;
    const target = focusRow === 'add' ? root?.querySelector<HTMLElement>('[data-testid="creator-add"]') : root?.querySelector<HTMLElement>(`[data-row="${focusRow}"] input`);
    target?.focus();
    setFocusRow(null);
  }, [focusRow]);

  /** Ends the edit; the pencil takes the focus back if the form had it. */
  const end = (returnFocus: boolean) => {
    const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
    useLibrary.getState().setEditing(null);
    if (returnFocus && hadFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="info-edit"]')?.focus());
  };
  /** Set when the quick search, not a pick of another row, took this item out of the selection. */
  const hiddenRef = useRef(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  /** One save at a time: a second press, or a row change while one is pending, waits for that one's answer. */
  const save = (value: CleanInfo): Promise<boolean> => {
    saveInFlight.current ??= write(value, draftRef.current).finally(() => {
      saveInFlight.current = null;
    });
    return saveInFlight.current;
  };
  /** True once the library has it; a failure is a toast and the form stays (spec §5.3). */
  const write = async (value: CleanInfo, sent: InfoDraft): Promise<boolean> => {
    setSaving(true);
    try {
      const saved = await unwrap(api().library.updateMetadata({ itemId: item.id, title: value.title, metadata: value.metadata }));
      // What the panel and the row show next, before libraryChanged's reads come back (no frame of the old values).
      queryClient.setQueryData<ItemDetail>(keys.detail(item.id), (d) => (d ? { ...d, item: saved, metadata: value.metadata } : d));
      queryClient.setQueryData<LibraryItem[]>(keys.items, (list) => list?.map((i) => (i.id === saved.id ? saved : i)));
      baseRef.current = sent;
      return true;
    } catch (err) {
      showToast({ kind: 'error', title: e.saveFailed, body: (err as Error).message, testId: 'save-failed' });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const focusFirstError = (errs: FieldErrors) => {
    const root = rootRef.current;
    const target = (): HTMLElement | null | undefined => {
      if (errs.title) return fieldInput(root, 'title');
      const row = draftRef.current.creators.find((c) => errs[`creator:${c.key}`] !== undefined);
      if (row) return root?.querySelector<HTMLElement>(`[data-row="${row.key}"] input`);
      const field = FIELD_ORDER.find((f) => errs[f] !== undefined);
      return field ? fieldInput(root, field) : null;
    };
    const el = target();
    el?.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  };
  /** 저장, ⌘↩ and ↩ in a one-line field. Nothing changed: the edit just ends (no write, 수정일 stays). */
  const submit = async () => {
    const v = validateInfo(draftRef.current);
    if (!v.ok) {
      setShowErrors(true);
      focusFirstError(v.errors);
      return;
    }
    if (sameInfo(draftRef.current, baseRef.current)) return end(true);
    // What was typed while the write ran is not saved yet: the form stays open with it (the next press saves it).
    if ((await save(v.value)) && sameInfo(draftRef.current, baseRef.current)) end(true);
  };
  /** The session's answer when something leaves the item (spec §5.3). */
  const leave = async (): Promise<boolean> => {
    const hidden = hiddenRef.current;
    hiddenRef.current = false;
    let v = validateInfo(draftRef.current);
    for (;;) {
      if (sameInfo(draftRef.current, baseRef.current)) {
        end(false);
        return true;
      }
      v = validateInfo(draftRef.current);
      if (!v.ok || !(await save(v.value))) break;
      // Typing that came while the write ran is saved too (the loop asks again), never dropped with the form.
    }
    if (!v.ok) {
      setShowErrors(true);
      setBlocked(true);
      revealInspector(); // a folded panel would hide why nothing moved (or why the window did not close)
    }
    // Back to the edited item (and after a failed save, whose toast says why): it is the anchor and the keyboard cursor
    // again too, so the arrows go on from it.
    // Not when the quick search hid the row: nothing off screen may be selected (spec 3.3), and the panel keeps showing
    // the edited item through editingId.
    if (!hidden) useLibrary.getState().setSelected([item.id]);
    // The focus goes to the marked field, not on in the table: the field draws its halo and the table's selection turns
    // neutral by itself. The answer never waits for a paint (a hidden or occluded window runs no frames, and main's
    // flush would time out and let the window go): focus now, and once more after the next frame if the table took it back.
    // Unless the person is typing elsewhere (the search field while the query hides this row): their keystrokes stay theirs.
    if (!v.ok && !typingOutside()) {
      focusFirstError(v.errors);
      requestAnimationFrame(() => {
        if (rootRef.current && !rootRef.current.contains(document.activeElement) && !typingOutside()) focusFirstError(v.errors);
      });
    }
    return false;
  };
  /** The focus is in a text field that is not part of this form. */
  const typingOutside = () => {
    const a = document.activeElement;
    return (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && !(rootRef.current?.contains(a) ?? false);
  };
  const leaveRef = useRef(leave);
  useLayoutEffect(() => {
    leaveRef.current = leave;
  });

  useEffect(() => openEditSession({ itemId: item.id, dirty: () => !sameInfo(draftRef.current, baseRef.current), leave: () => leaveRef.current() }), [item.id]);
  // Another row: whatever the table did — a press, an arrow, ⌘A, esc emptying it, the first press of a
  // double-click — the edit is asked first (a selection of exactly this item is no change; nor is our own setSelected).
  useEffect(
    () =>
      useLibrary.subscribe((s, prev) => {
        if (s.selected === prev.selected || (s.selected.size === 1 && s.selected.has(item.id))) return;
        // The quick search hiding the row is not a pick of another row (store: pruned).
        hiddenRef.current = s.pruned !== prev.pruned && s.pruned.has(item.id);
        void leaveEditing();
      }),
    [item.id],
  );
  useEffect(() => {
    if (takeFocusRequest(item.id)) fieldInput(rootRef.current, 'title')?.focus();
  }, [item.id]);

  // A key that only finishes a Korean composition (design-spec 7.4) neither saves nor cancels.
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (isComposingKey(ev) || ev.key === 'Process') return;
    const command = currentPlatform() === 'darwin' ? ev.metaKey : ev.ctrlKey;
    const plain = !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey;
    if (ev.key === 'Enter' && (command || (plain && ev.target instanceof HTMLInputElement))) {
      ev.preventDefault();
      void submit();
    } else if (ev.key === 'Escape' && plain) {
      ev.preventDefault();
      ev.stopPropagation();
      end(true);
    }
  };

  return (
    <div ref={rootRef} className="editor" role="form" aria-label={e.form} data-testid="info-editor" onKeyDown={onKeyDown}>
      {blocked && (
        <div className="ed-unsaved" role="alert" data-testid="editor-unsaved">
          <Icon icon={TriangleAlert} size="sm" />
          <span className="ed-unsaved-text">{e.unsaved}</span>
          <Button variant="plain-danger" size="small" testId="editor-discard" onPress={() => end(true)}>
            {e.discard}
          </Button>
        </div>
      )}
      <EditorText field="title" label={e.title} value={draft.title} onChange={(title) => set({ title })} error={errors.title} />
      <div className="ed-field ed-creators" role="group" aria-label={e.creators}>
        <span className="ed-label" aria-hidden="true">
          {e.creators}
        </span>
        {draft.creators.map((c, i) => {
          const error = errors[`creator:${c.key}`];
          return (
            <div key={c.key} className="ed-creator" data-testid="creator-row" data-index={i} data-row={c.key}>
              <TextField className="ed-name" aria-label={e.creatorName(i + 1)} value={c.name} onChange={(name) => setCreator(i, { name })} isInvalid={error !== undefined} validationBehavior="aria">
                <Input className="field ed-input" />
                <FieldError className="ed-error">{error}</FieldError>
              </TextField>
              <span className="ed-select-wrap">
                <select
                  className="field ed-select"
                  aria-label={e.creatorRole(i + 1)}
                  value={c.role}
                  onChange={(ev) => setCreator(i, { role: ev.target.value as CreatorDraft['role'] })}
                  data-testid="creator-role"
                >
                  {CREATOR_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t.inspector.roles[r]}
                    </option>
                  ))}
                </select>
                <Icon icon={ChevronDown} size="xs" />
              </span>
              <IconButton icon={ChevronUp} size="small" label={e.creatorUp(i + 1)} isDisabled={i === 0} disabledReason={e.creatorFirst} onPress={() => moveCreator(i, -1)} testId="creator-up" />
              <IconButton icon={ChevronDown} size="small" label={e.creatorDown(i + 1)} isDisabled={i === draft.creators.length - 1} disabledReason={e.creatorLast} onPress={() => moveCreator(i, 1)} testId="creator-down" />
              <IconButton icon={Minus} size="small" label={e.creatorRemove(i + 1)} onPress={() => removeCreator(i)} testId="creator-remove" />
            </div>
          );
        })}
        <div className="ed-add">
          <Button variant="plain" size="small" icon={Plus} leading testId="creator-add" onPress={addCreator}>
            {e.addCreator}
          </Button>
        </div>
      </div>
      <EditorText field="date" label={e.date} value={draft.date} onChange={(date) => set({ date })} error={errors.date} placeholder={e.datePlaceholder} />
      <EditorText field="publisher" label={e.publisher} value={draft.publisher} onChange={(publisher) => set({ publisher })} error={errors.publisher} />
      <EditorText field="language" label={e.language} value={draft.language} onChange={(language) => set({ language })} error={errors.language} placeholder={e.languagePlaceholder} />
      <EditorText field="url" label={e.url} value={draft.url} onChange={(url) => set({ url })} error={errors.url} placeholder={e.urlPlaceholder} />
      <EditorText field="abstract" label={e.abstract} value={draft.abstract} onChange={(abstract) => set({ abstract })} error={errors.abstract} multiline />
      <EditorText field="extra" label={e.extra} value={draft.extra} onChange={(extra) => set({ extra })} error={errors.extra} multiline />
      <div className="ed-actions">
        <Button testId="editor-cancel" onPress={() => end(true)}>
          {t.common.cancel}
        </Button>
        <Button variant="primary" testId="editor-save" isPending={saving} onPress={() => void submit()}>
          {e.save}
        </Button>
      </div>
    </div>
  );
}

/** One labelled field: the label above (the panel is 288 wide), the footnote under it while it is marked. */
function EditorText(props: { field: InfoTextField; label: string; value: string; onChange(value: string): void; error: string | undefined; placeholder?: string; multiline?: boolean }) {
  return (
    <TextField className="ed-field" data-testid="editor-field" data-field={props.field} value={props.value} onChange={props.onChange} isInvalid={props.error !== undefined} validationBehavior="aria">
      <Label className="ed-label">{props.label}</Label>
      {props.multiline ? <TextArea className="field ed-input ed-text" rows={4} /> : <Input className="field ed-input" placeholder={props.placeholder} />}
      <FieldError className="ed-error">{props.error}</FieldError>
    </TextField>
  );
}
