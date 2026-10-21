import { describe, expect, it } from 'vitest';
import { aboutPanelOptions } from './about';

describe('About panel', () => {
  it('names the app, its version and the bundled open-source licences', () => {
    const o = aboutPanelOptions('0.1.0', '44.9.1');
    expect(o).toMatchObject({ applicationName: 'Learn', applicationVersion: '0.1.0', version: 'Electron 44.9.1' });
    for (const name of ['Pretendard', 'Lucide', 'React Aria', 'PDF.js', 'OFL', 'ISC', 'Apache', 'MIT']) expect(o.credits).toContain(name);
  });
});
