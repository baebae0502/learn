import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { Popover } from 'react-aria-components';
import type { OrganizeTag } from '@learn/domain';
import type { TagPick } from '../organize/itemTags';
import { tooLong } from '../sidebar/nameEdit';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { addFieldKey } from './addFieldKeys';
import { tagColorVar } from './tagColor';
import { suggestTags } from './tagSuggestions';

export interface TagAddFieldProps {
  /** Every tag there is (the snapshot's list). */
  tags: readonly OrganizeTag[];
  /** Tags not offered: the ones every one of the items has already. */
  exclude: ReadonlySet<string>;
  /** The field's name for a screen reader: 태그 추가, or 모두에 태그 추가 for several items. */
  label: string;
  /** Puts the pick on the items. True when it is done (the field then empties); false after the caller told the user why. */
  onAttach(pick: TagPick): Promise<boolean>;
  /** esc closes it (`key`: the focus goes back to the chip that opened it); a click or Tab away closes it too (`blur`). */
  onClose(by: 'key' | 'blur'): void;
}

const fold = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase('ko-KR');

/**
 * The inline field the "태그 추가" chip becomes (spec 6.1, Zotero's way): suggestions of existing tags below it as you
 * type, ↑↓ choose, ↩ attaches the chosen one or the typed name, esc closes, and the field stays open for the next tag.
 * The keys are decided by `addFieldKey`, which leaves everything a Korean composition owns alone.
 */
export function TagAddField({ tags, exclude, label, onAttach, onClose }: TagAddFieldProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const listId = useId();
  const shown = useMemo(() => suggestTags(tags, exclude, text), [tags, exclude, text]);
  const at = active < shown.length ? active : -1;
  const typed = text.trim();
  const long = tooLong(text);
  const known = typed !== '' && tags.some((tag) => fold(tag.name) === fold(typed));
  const hint = at < 0 && typed !== '' && !known && !long;
  useEffect(() => {
    input.current?.focus();
  }, []);

  const attach = async (pick: TagPick) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onAttach(pick)) {
        setText('');
        setActive(-1);
      }
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const commit = async () => {
    const chosen = at >= 0 ? shown[at] : undefined;
    if (chosen) await attach({ tag: chosen });
    else if (typed !== '' && !long) await attach({ name: typed });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const action = addFieldKey(
      { key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey },
      { text, active: at, count: shown.length },
    );
    switch (action.do) {
      case 'none':
        return;
      case 'ignore':
        e.stopPropagation();
        return;
      case 'move':
        e.preventDefault();
        e.stopPropagation();
        setActive(action.to);
        return;
      case 'commit':
        e.preventDefault();
        e.stopPropagation();
        void commit();
        return;
      case 'close':
        e.preventDefault();
        e.stopPropagation();
        onClose('key');
        return;
    }
  };

  return (
    <div
      className="tag-field"
      data-testid="tag-field"
      onBlur={(e) => {
        // Focus left the field and its list (a click elsewhere, Tab) — but not because the whole window went to the background.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && document.hasFocus()) onClose('blur');
      }}
    >
      <div ref={anchor} className="tag-input-wrap">
        <Icon icon={Plus} size="sm" />
        <input
          ref={input}
          className="tag-input"
          data-testid="tag-input"
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? `${listId}-${at}` : undefined}
          aria-invalid={long || undefined}
          aria-busy={busy || undefined}
          placeholder={t.organize.panel.tags.field}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {long && (
        <p className="tag-error" role="alert" data-testid="tag-error">
          {t.organize.panel.tags.tooLong}
        </p>
      )}
      {(shown.length > 0 || hint) && (
        // Floats under the field, so the sections below stay where they are while the list changes with every letter. Not modal and
        // never focused: the focus stays in the field (a press on the list must not blur it), the rows are reached by ↑↓.
        <Popover className="tag-suggest-popover" triggerRef={anchor} isOpen isNonModal placement="bottom start" offset={4}>
          {shown.length > 0 && (
            <ul id={listId} className="tag-suggest" role="listbox" aria-label={t.organize.panel.tags.suggestions} data-testid="tag-suggestions" onMouseDown={(e) => e.preventDefault()}>
              {shown.map((tag, i) => (
                <li
                  key={tag.id}
                  id={`${listId}-${i}`}
                  className="tag-suggest-row"
                  role="option"
                  aria-selected={i === at}
                  data-testid="tag-suggestion"
                  data-tag-id={tag.id}
                  data-active={i === at ? '' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void attach({ tag })}
                >
                  <span className="tag-suggest-mark" aria-hidden="true">
                    {tag.position !== null && <i className="dot" style={{ background: tagColorVar(tag.position) }} />}
                  </span>
                  <span className="ellipsis">{tag.name}</span>
                </li>
              ))}
            </ul>
          )}
          {hint && (
            <p className="tag-hint" data-testid="tag-hint" onMouseDown={(e) => e.preventDefault()}>
              {t.organize.panel.tags.create(typed)}
            </p>
          )}
        </Popover>
      )}
    </div>
  );
}
