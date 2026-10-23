import { useEffect, useState } from 'react';
import { Folder, FolderSearch } from 'lucide-react';
import { Radio, RadioGroup } from 'react-aria-components';
import { DEFAULT_PREFS, type Prefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { useAppInfo, usePrefs, usePrefsSync } from '../data/queries';
import { homeRelative } from '../format';
import { DemoOverlay } from '../shell/DemoOverlay';
import { useWindowState } from '../shell/useWindowState';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { currentPlatform, readWindowParams } from '../ui/platform';
import { Segmented } from '../ui/Segmented';
import { ThemePreview } from './ThemePreview';
import { pickSettled, shownTheme, useApplyTheme } from './theme';

const THEMES = ['system', 'light', 'dark'] as const;
const DENSITIES = ['compact', 'regular', 'comfortable'] as const;
const SIZES = [12, 13, 14, 15] as const;

/** A failure from main: its message is already Korean (cause + next step). */
const messageOf = (e: unknown) => (e as Error).message;

/**
 * The ⌘, settings window (?window=settings; settings.html, design-spec 6 설정 창 and 10.6). Every change applies at
 * once — main broadcasts prefsChanged and the main window applies it — so there is no 완료 or × button. The library
 * location is main's: this page only asks main to pick, check and confirm a folder (R4; it never sends a path).
 * Main sizes the window to [data-settings-root].
 */
export function SettingsApp() {
  useWindowState(); // its own state: not key → no rings, neutral selection (design-spec 2.1)
  usePrefsSync();
  const prefsQuery = usePrefs();
  const info = useAppInfo();
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  useEffect(() => {
    document.title = t.settings.title; // the window title follows the page title in Electron
  }, []);
  // The theme tile just picked: selected, and this window's theme changed, on the click (T13M-m6). It gives way to the
  // saved pref once that has come round to it, or when the write fails.
  const [pickedTheme, setPickedTheme] = useState<Prefs['theme'] | null>(null);
  const savedTheme = prefsQuery.data?.theme;
  useEffect(() => {
    if (pickSettled(pickedTheme, savedTheme)) setPickedTheme(null);
  }, [pickedTheme, savedTheme]);
  useApplyTheme(pickedTheme ?? savedTheme);
  if (prefsQuery.isPending || info.isPending) return null;
  const prefs = prefsQuery.data ?? DEFAULT_PREFS;

  const set = (patch: Partial<Omit<Prefs, 'libraryRoot'>>, failed?: () => void) => {
    setPrefsError(null);
    void unwrap(api().prefs.set(patch)).catch((e: unknown) => {
      failed?.();
      setPrefsError(messageOf(e));
    });
  };
  const pickTheme = (theme: Prefs['theme']) => {
    setPickedTheme(theme);
    set({ theme }, () => setPickedTheme((picked) => (picked === theme ? null : picked)));
  };
  const library = async (run: () => Promise<unknown>) => {
    setLibraryError(null);
    try {
      await run();
    } catch (e) {
      setLibraryError(messageOf(e));
    }
  };

  return (
    <>
      <div className="settings" data-settings-root="" data-testid="settings-root">
        <section aria-labelledby="g-appearance">
          <h2 className="group-label" id="g-appearance">
            {t.settings.appearance}
          </h2>
          <div className="form-group">
            <div className="form-row stacked">
              <span className="fr-label" id="l-theme">
                {t.settings.theme}
              </span>
              <RadioGroup
                aria-labelledby="l-theme"
                orientation="horizontal"
                value={shownTheme(pickedTheme, prefs.theme)}
                onChange={(v) => pickTheme(v as Prefs['theme'])}
                className="theme-tiles"
              >
                {THEMES.map((v) => (
                  <Radio key={v} value={v} className="theme-tile" data-testid={`theme-tile-${v}`}>
                    {/* The selection ring is the frame's border, 2 px off the picture with the group showing through. */}
                    <span className="frame">
                      <ThemePreview kind={v} />
                    </span>
                    <span>{t.settings.themes[v]}</span>
                  </Radio>
                ))}
              </RadioGroup>
            </div>
            <div className="form-row">
              <span className="fr-label">
                <span id="l-density">{t.settings.density}</span>
                <span className="hint">{t.settings.densityHint}</span>
              </span>
              <Segmented
                aria-labelledby="l-density"
                value={prefs.density}
                onChange={(density) => set({ density })}
                options={DENSITIES.map((v) => ({ value: v, label: t.settings.densities[v], testId: `density-${v}` }))}
              />
            </div>
            <div className="form-row">
              <span className="fr-label">
                <span id="l-font">{t.settings.fontSize}</span>
                <span className="hint">{t.settings.fontSizeHint}</span>
              </span>
              <Segmented
                aria-labelledby="l-font"
                value={String(prefs.fontSize)}
                onChange={(v) => set({ fontSize: Number(v) as Prefs['fontSize'] })}
                options={SIZES.map((v) => ({ value: String(v), label: t.settings.fontSizes[v], title: t.settings.fontSizePt(v), testId: `font-size-${v}` }))}
              />
            </div>
          </div>
          {prefsError && (
            <p className="field-error" role="alert" data-testid="prefs-error">
              {prefsError}
            </p>
          )}
        </section>
        {info.data && (
          <section aria-labelledby="g-library">
            <h2 className="group-label" id="g-library">
              {t.settings.library}
            </h2>
            <div className="form-group">
              <div className="form-row stacked">
                <span className="fr-label">
                  <span>{t.settings.location}</span>
                  <span className="hint ui-prose">{t.settings.locationHint}</span>
                </span>
                {/* The home folder as ~ (design-spec 4); the full path in the tooltip; the end is cut, never the middle. */}
                <div className="path-box" title={info.data.libraryRoot} data-testid="library-path">
                  <Icon icon={Folder} size="sm" />
                  <span className="ellipsis">{homeRelative(info.data.libraryRoot, info.data.homeDir)}</span>
                </div>
                <div className="row-actions">
                  <Button icon={FolderSearch} testId="library-reveal" onPress={() => void library(() => unwrap(api().app.showLibraryFolder()))}>
                    {currentPlatform() === 'darwin' ? t.settings.reveal.darwin : t.settings.reveal.other}
                  </Button>
                  <Button testId="library-choose" onPress={() => void library(() => unwrap(api().app.chooseLibraryFolder()))}>
                    {t.settings.choose}
                  </Button>
                </div>
                {libraryError && (
                  <p className="field-error" role="alert" data-testid="library-error">
                    {libraryError}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      {/* Demo recordings only (main sets demo=1 for LEARN_DEMO_OVERLAY=1 in an unpackaged build); fixed, outside the
          measured root. */}
      {readWindowParams(location.search).demo && <DemoOverlay />}
    </>
  );
}
