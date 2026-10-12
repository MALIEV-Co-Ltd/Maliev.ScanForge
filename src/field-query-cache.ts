/** Recovered cache-ready bit: only bit zero controls query-context validity. */
export function guideQueryCacheValid(flags: number): boolean {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff)
    throw new Error("Query cache flags must be an unsigned 32-bit integer");
  return (flags & 1) !== 0;
}
