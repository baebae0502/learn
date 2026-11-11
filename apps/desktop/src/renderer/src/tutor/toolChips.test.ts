import { describe, expect, it } from 'vitest';
import type { ToolChip } from '@learn/domain';
import { mergeToolChips } from './toolChips';

const c = (tool: ToolChip['tool'], outcome: ToolChip['outcome'], from: number | null = null, to: number | null = from, withSelection = false): ToolChip => ({ tool, outcome, pageFrom: from, pageTo: to, withSelection });

describe('the tool chips over an answer (P-12)', () => {
  it('merges the pages read into runs and names get_context by the selection', () => {
    expect(mergeToolChips([c('get_context', 'ok', null, null, true), c('get_outline', 'ok'), c('read_pdf_pages', 'ok', 40), c('read_pdf_pages', 'duplicate', 41), c('read_pdf_pages', 'ok', 44, 45), c('read_pdf_pages', 'refused'), c('read_pdf_pages', 'pending', 46)]))
      .toEqual([{ kind: 'selection' }, { kind: 'outline' }, { kind: 'read', from: 40, to: 41 }, { kind: 'read', from: 44, to: 45 }, { kind: 'refused' }, { kind: 'unread' }]);
    expect(mergeToolChips([c('get_context', 'ok')], c('read_pdf_pages', 'ok', 41))).toEqual([{ kind: 'position' }, { kind: 'reading', from: 41, to: 41 }]);
  });
  it('says each kind once, puts overlapping reads in one run, and draws no chip for a call still running that is not a read', () => {
    expect(mergeToolChips([c('read_pdf_pages', 'ok', 44, 46), c('get_outline', 'ok'), c('read_pdf_pages', 'limited', 40, 45), c('get_outline', 'ok'), c('read_pdf_pages', 'failed'), c('read_pdf_pages', 'refused'), c('read_pdf_pages', 'refused')], c('get_context', 'ok')))
      .toEqual([{ kind: 'read', from: 40, to: 46 }, { kind: 'outline' }, { kind: 'unread' }, { kind: 'refused' }]);
    expect(mergeToolChips([])).toEqual([]);
  });
});
