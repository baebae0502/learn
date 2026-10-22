import { describe, expect, it } from 'vitest';
import { modeArguments, parseDisplayplacerList, pickDemoMode, restoreArguments } from './display';

// displayplacer v1.4.0 `list`, shaped like its README (a Retina panel and an external 1x screen), trimmed.
const LIST = `Persistent screen id: 37D8832A-2D66-02CA-B9F7-8F30A301B230
Contextual screen id: 1
Serial screen id: s4251086178
Type: MacBook built in screen
Resolution: 1440x900
Hertz: N/A
Color Depth: 8
Scaling: on
Origin: (0,0) - main display
Rotation: 0 - rotate internal screen example (may crash computer, but will be rotated after rebooting): \`displayplacer "id:37D8832A-2D66-02CA-B9F7-8F30A301B230 degree:90"\`
Enabled: true
Resolutions for rotation 0:
  mode 0: res:1440x900 color_depth:4 scaling:on
  mode 1: res:1440x900 color_depth:8 scaling:on <-- current mode
  mode 2: res:1680x1050 color_depth:8 scaling:on
  mode 3: res:1024x640 color_depth:8 scaling:on
  mode 4: res:2880x1800 color_depth:8
  mode 5: res:1280x800 color_depth:8

Persistent screen id: F466F621-B5FA-04A0-0800-CFA6C258DECD
Contextual screen id: 2
Serial screen id: s1092
Type: 24 inch external screen
Resolution: 1024x768
Hertz: 60
Color Depth: 8
Scaling: off
Origin: (1440,0)
Rotation: 0
Enabled: true
Resolutions for rotation 0:
  mode 0: res:1024x768 hz:60 color_depth:8 <-- current mode
  mode 1: res:800x600 hz:60 color_depth:8
  mode 2: res:1920x1080 hz:60 color_depth:8
  mode 3: res:1440x900 hz:60 color_depth:8
  mode 4: res:1440x900 hz:75 color_depth:8
  mode 5: res:2560x1440 hz:60 color_depth:8

Execute the command below to set your screens to the current arrangement. If screen ids are switching, please run \`displayplacer --help\` for info on using contextual or serial ids instead of persistent ids.

displayplacer "id:37D8832A-2D66-02CA-B9F7-8F30A301B230 res:1440x900 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0" "id:F466F621-B5FA-04A0-0800-CFA6C258DECD res:1024x768 hz:60 color_depth:8 enabled:true scaling:off origin:(1440,0) degree:0"
`;

// A runner-like screen: one 1024×768 @1x display with nothing larger.
const SMALL = `Persistent screen id: 6B2E9A1C-0000-0000-0000-000000000001
Contextual screen id: 1
Type: Unknown
Resolution: 1024x768
Hertz: 60
Color Depth: 8
Scaling: off
Origin: (0,0) - main display
Rotation: 0
Enabled: true
Resolutions for rotation 0:
  mode 0: res:1024x768 hz:60 color_depth:8 <-- current mode
  mode 1: res:800x600 hz:60 color_depth:8

displayplacer "id:6B2E9A1C-0000-0000-0000-000000000001 res:1024x768 hz:60 color_depth:8 enabled:true scaling:off origin:(0,0) degree:0"
`;

describe('displayplacer list', () => {
  it('reads every screen with its ids, current state and every mode', () => {
    const list = parseDisplayplacerList(LIST);
    expect(list.screens.map((s) => [s.id, s.contextualId, s.type, s.main])).toEqual([
      ['37D8832A-2D66-02CA-B9F7-8F30A301B230', '1', 'MacBook built in screen', true],
      ['F466F621-B5FA-04A0-0800-CFA6C258DECD', '2', '24 inch external screen', false],
    ]);
    const [retina, external] = list.screens;
    expect(retina!.modes).toHaveLength(6);
    expect(retina!.modes[1]).toEqual({ mode: 1, width: 1440, height: 900, hz: null, colorDepth: 8, scaling: true, current: true });
    expect(retina!.modes[4]).toEqual({ mode: 4, width: 2880, height: 1800, hz: null, colorDepth: 8, scaling: false, current: false });
    expect(external!.modes[4]).toEqual({ mode: 4, width: 1440, height: 900, hz: 75, colorDepth: 8, scaling: false, current: false });
    expect(list.restore).toHaveLength(2);
  });
  it('keeps the arrangement command to put the screens back', () => {
    expect(restoreArguments(parseDisplayplacerList(SMALL))).toEqual(['id:6B2E9A1C-0000-0000-0000-000000000001 res:1024x768 hz:60 color_depth:8 enabled:true scaling:off origin:(0,0) degree:0']);
  });
  it('reads nothing from output that is not a list', () => {
    expect(parseDisplayplacerList('zsh: command not found: displayplacer')).toEqual({ screens: [], restore: [] });
  });
});

describe('the demo display mode', () => {
  it('prefers a HiDPI mode that holds the 1440 × 900 window, the smallest such', () => {
    const [retina] = parseDisplayplacerList(LIST).screens;
    expect(pickDemoMode(retina!)).toMatchObject({ mode: 1, width: 1440, height: 900, scaling: true });
  });
  it('else a 1x mode that holds it, never wider than 1920, the fastest refresh', () => {
    const [, external] = parseDisplayplacerList(LIST).screens;
    expect(pickDemoMode(external!)).toMatchObject({ mode: 4, width: 1440, height: 900, hz: 75 });
  });
  it('takes a HiDPI mode below 1440 only when nothing holds the window', () => {
    const screen = parseDisplayplacerList(LIST).screens[0]!;
    // 1024×640 @2x, 2880×1800 @1x (wider than 1920) and 1280×800 @1x (1x and below 1440: no gain).
    const small = { ...screen, modes: screen.modes.filter((m) => [3, 4, 5].includes(m.mode)) };
    expect(pickDemoMode(small)).toMatchObject({ mode: 3, width: 1024, scaling: true });
  });
  it('has nothing to offer a 1024 × 768 screen without HiDPI modes', () => {
    expect(pickDemoMode(parseDisplayplacerList(SMALL).screens[0]!)).toBeNull();
  });
  it('switches one screen to one mode with displayplacer arguments', () => {
    const [, external] = parseDisplayplacerList(LIST).screens;
    expect(modeArguments(external!, pickDemoMode(external!)!)).toEqual(['id:F466F621-B5FA-04A0-0800-CFA6C258DECD res:1440x900 hz:75 color_depth:8 scaling:off']);
    const [retina] = parseDisplayplacerList(LIST).screens;
    expect(modeArguments(retina!, retina!.modes[2]!)).toEqual(['id:37D8832A-2D66-02CA-B9F7-8F30A301B230 res:1680x1050 color_depth:8 scaling:on']);
  });
});
