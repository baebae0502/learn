import { describe, expect, it } from 'vitest';
import { ROOM, roomAfterJump } from './placement';

const stage = { scrollTop: 900, scrollLeft: 0, width: 800, height: 600 };
const page = { top: 900, left: 100, width: 600, height: 840 };
const v = { flow: 'vertical', firstRow: false, keepTop: false, keepLeft: false } as const;

describe('roomAfterJump, vertical flow', () => {
  it('a page landing flush at the top keeps 12 above it, the first row 24', () => {
    expect(roomAfterJump({ ...v, page, stage }).scrollTop).toBe(888);
    expect(roomAfterJump({ ...v, page: { ...page, top: 24 }, firstRow: true, stage: { ...stage, scrollTop: 24 } }).scrollTop).toBe(0);
    expect(ROOM).toEqual({ first: 24, between: 12, side: 24 });
  });
  it('a point inside the page is kept', () => {
    expect(roomAfterJump({ ...v, page, stage, keepTop: true }).scrollTop).toBe(900);
  });
  it('a place more than 1 px from the page edge is left alone', () => {
    expect(roomAfterJump({ ...v, page, stage: { ...stage, scrollTop: 903 } }).scrollTop).toBe(903);
    expect(roomAfterJump({ ...v, page, stage: { ...stage, scrollTop: 899 } }).scrollTop).toBe(888);
  });
  it('never scrolls above the start', () => {
    expect(roomAfterJump({ ...v, page: { ...page, top: 5 }, stage: { ...stage, scrollTop: 5 } }).scrollTop).toBe(0);
  });
  it('a page wider than the stage keeps 24 on its left when the jump lands at its edge', () => {
    const wide = { top: 900, left: 24, width: 1200, height: 840 };
    expect(roomAfterJump({ ...v, page: wide, stage: { ...stage, scrollLeft: 24 } }).scrollLeft).toBe(0);
    const farther = { ...wide, left: 60 };
    expect(roomAfterJump({ ...v, page: farther, stage: { ...stage, scrollLeft: 60 } }).scrollLeft).toBe(36);
    expect(roomAfterJump({ ...v, page: farther, stage: { ...stage, scrollLeft: 60 }, keepLeft: true }).scrollLeft).toBe(60);
  });
  it('a page narrower than the stage leaves the left alone', () => {
    expect(roomAfterJump({ ...v, page, stage: { ...stage, scrollLeft: 100 } }).scrollLeft).toBe(100);
  });
  it('a left more than 1 px from the page edge is left alone', () => {
    const wide = { top: 900, left: 24, width: 1200, height: 840 };
    expect(roomAfterJump({ ...v, page: wide, stage: { ...stage, scrollLeft: 300 } }).scrollLeft).toBe(300);
  });
});

describe('roomAfterJump, horizontal flow', () => {
  const h = { ...v, flow: 'horizontal' } as const;
  const hstage = { scrollTop: 0, scrollLeft: 900, width: 800, height: 600 };
  const hpage = { top: 24, left: 900, width: 600, height: 400 };
  it('a page landing flush at the left keeps 12 before it, the first 24', () => {
    expect(roomAfterJump({ ...h, page: hpage, stage: hstage }).scrollLeft).toBe(888);
    expect(roomAfterJump({ ...h, page: { ...hpage, left: 24 }, firstRow: true, stage: { ...hstage, scrollLeft: 24 } }).scrollLeft).toBe(0);
    expect(roomAfterJump({ ...h, page: hpage, stage: hstage, keepLeft: true }).scrollLeft).toBe(900);
  });
  it('a page taller than the stage keeps 24 above it when it lands at its top', () => {
    const tall = { ...hpage, top: 40, height: 900 };
    expect(roomAfterJump({ ...h, page: tall, stage: { ...hstage, scrollTop: 40 } }).scrollTop).toBe(16);
    expect(roomAfterJump({ ...h, page: tall, stage: { ...hstage, scrollTop: 40 }, keepTop: true }).scrollTop).toBe(40);
    expect(roomAfterJump({ ...h, page: hpage, stage: { ...hstage, scrollTop: 24 } }).scrollTop).toBe(24);
  });
});
