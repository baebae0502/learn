/**
 * When the rows of the trash panel were moved there, if it was the same moment for all of them: the line under 복원 then
 * says "· …에 옮김"; rows trashed at different times say only where (null).
 */
export function sharedTrashedAt(rows: readonly { deletedAt: string }[]): string | null {
  const first = rows[0]?.deletedAt;
  return first !== undefined && rows.every((r) => r.deletedAt === first) ? first : null;
}
