import { describe, expect, it } from 'vitest';
import { sameTutorView } from './useTutorView';

const ITEM = '3f0d9a0e-6b1e-4c1e-8f6a-1d2f9b7c5e11';
const SESSION = '8a6e1c52-2f3b-4d0e-9a41-7b5c3e2d1f00';

describe('what the window tells main about the session on screen (tutor:view)', () => {
  it('a window that shows no session sends nothing: null after null is the same value', () => {
    expect(sameTutorView(null, null)).toBe(true);
  });
  it('a session appearing, leaving, or becoming another is a change', () => {
    expect(sameTutorView(null, { itemId: ITEM, conversationId: null })).toBe(false);
    expect(sameTutorView({ itemId: ITEM, conversationId: null }, null)).toBe(false);
    expect(sameTutorView({ itemId: ITEM, conversationId: null }, { itemId: ITEM, conversationId: SESSION })).toBe(false);
    expect(sameTutorView({ itemId: ITEM, conversationId: SESSION }, { itemId: ITEM, conversationId: SESSION })).toBe(true);
  });
});
