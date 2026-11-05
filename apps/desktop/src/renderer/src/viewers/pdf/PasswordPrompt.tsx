import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { formatSize } from '../../format';
import { t } from '../../strings';
import { Button } from '../../ui/Button';
import { isComposingKey } from '../../ui/ime';
import { Notice } from '../../ui/Notice';

/** The password of a protected PDF: shown in place of the stage, the window toolbar already names the file. */
export function PasswordPrompt({ item, wrong, checking, onSubmit }: { item: LibraryItem; wrong: boolean; checking: boolean; onSubmit(password: string): void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value !== '' && !checking) onSubmit(value);
  };
  return (
    <div className="reader-stage">
      <div className="stage-center">
        <Notice
          icon={Lock}
          title={t.reader.lockedTitle}
          fileName={`${item.originalName} · ${formatSize(item.size)}`}
          testId="pdf-locked"
          actions={
            <form className="password-form" onSubmit={submit}>
              <div className="password-row">
                <input
                  className="password-input"
                  type="password"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t.reader.password}
                  placeholder={t.reader.password}
                  aria-invalid={wrong || undefined}
                  aria-describedby={wrong ? 'pdf-password-error' : undefined}
                  data-testid="pdf-password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    // The ↩ that confirms a Korean syllable is not a submit.
                    if (e.key === 'Enter' && isComposingKey(e)) e.preventDefault();
                  }}
                />
                <Button variant="primary" type="submit" isDisabled={value === '' || checking} testId="pdf-password-open">
                  {t.reader.passwordOpen}
                </Button>
              </div>
              {wrong && (
                <div id="pdf-password-error" className="password-error" role="alert" data-testid="pdf-password-error">
                  {t.reader.passwordWrong}
                </div>
              )}
            </form>
          }
        >
          {t.reader.lockedBody}
        </Notice>
      </div>
    </div>
  );
}
