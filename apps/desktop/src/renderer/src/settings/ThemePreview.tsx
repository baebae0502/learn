import { themeHex } from '../design/tokens.generated';

type PaneColours = { side: string; main: string; line: string; accent: string };
const pane = (theme: 'light' | 'dark'): PaneColours => {
  const c = themeHex[theme];
  return { side: c.bgSidebar, main: c.bgContent, line: c.separator, accent: c.accent };
};
const LIGHT = pane('light');
const DARK = pane('dark');

/** One window in miniature: a sidebar (an accent row and two lines) beside the content (four lines). */
function Pane({ c, clip }: { c: PaneColours; clip?: string }) {
  return (
    <div className="pv" style={clip ? { clipPath: clip } : undefined}>
      <div className="pv-side" style={{ background: c.side }}>
        <i style={{ background: c.accent, width: '80%' }} />
        <i style={{ background: c.line, width: '60%' }} />
        <i style={{ background: c.line, width: '70%' }} />
      </div>
      <div className="pv-main" style={{ background: c.main }}>
        {['90%', '70%', '80%', '50%'].map((w) => (
          <i key={w} style={{ background: c.line, width: w }} />
        ))}
      </div>
    </div>
  );
}

/**
 * The theme tile's picture (settings.html themePreview), in each theme's own colours whatever the window shows now:
 * system = the light window's left half beside the dark window's right half.
 */
export function ThemePreview({ kind }: { kind: 'system' | 'light' | 'dark' }) {
  return (
    <div className="preview" aria-hidden="true">
      {kind === 'system' ? (
        <>
          <Pane c={LIGHT} clip="inset(0 50% 0 0)" />
          <Pane c={DARK} clip="inset(0 0 0 50%)" />
        </>
      ) : (
        <Pane c={kind === 'dark' ? DARK : LIGHT} />
      )}
      <span className="lights">
        <b />
        <b />
        <b />
      </span>
    </div>
  );
}
