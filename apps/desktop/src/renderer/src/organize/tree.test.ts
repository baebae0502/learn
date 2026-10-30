import { describe, expect, it } from 'vitest';
import type { OrganizeCollection } from '@learn/domain';
import { buildTree } from './tree';

const at = '2026-10-01T00:00:00.000Z';
const c = (id: string, name: string, parentId: string | null = null, createdAt = at): OrganizeCollection => ({ id, name, parentId, createdAt });
const names = (nodes: readonly { name: string }[]) => nodes.map((n) => n.name);

describe('the collection tree (spec 3.3)', () => {
  it('orders siblings by Korean name with numbers by value: 6장 < 7장 < 10장', () => {
    const tree = buildTree([c('a', '10장'), c('b', '6장'), c('c', '7장'), c('d', '가'), c('e', '나')]);
    expect(names(tree.roots)).toEqual(['6장', '7장', '10장', '가', '나']);
  });
  it('nests children under their parent with their depth, and lists the nodes in tree order', () => {
    const tree = buildTree([c('bio', '분자생물학'), c('c10', '10장', 'bio'), c('c6', '6장', 'bio'), c('stat', '통계'), c('reg', '회귀분석', 'stat'), c('deep', '잔차', 'reg')]);
    expect(names(tree.flat)).toEqual(['분자생물학', '6장', '10장', '통계', '회귀분석', '잔차']);
    expect(tree.flat.map((n) => n.depth)).toEqual([0, 1, 1, 0, 1, 2]);
    expect(tree.byId.get('deep')?.parentId).toBe('reg');
    expect(names(tree.byId.get('bio')!.children)).toEqual(['6장', '10장']);
  });
  it('puts equal names in creation order, then by id, so every build orders them alike', () => {
    const tree = buildTree([c('z', '같은 이름', null, '2026-10-02T00:00:00.000Z'), c('b', '같은 이름', null, at), c('a', '같은 이름', null, at)]);
    expect(tree.roots.map((n) => n.id)).toEqual(['a', 'b', 'z']);
  });
  it('shows a collection whose parent is not live as a top-level one, and drops a cycle without looping', () => {
    const tree = buildTree([c('orphan', '고아', 'gone'), c('self', '자기', 'self'), c('x', '순환 1', 'y'), c('y', '순환 2', 'x')]);
    expect(names(tree.roots)).toEqual(['고아', '자기']);
    expect(tree.byId.get('orphan')?.parentId).toBeNull();
    expect(tree.byId.has('x')).toBe(false);
    expect(buildTree([]).roots).toEqual([]);
  });
});
