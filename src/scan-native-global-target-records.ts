/** Original raw-child target loop: restart at zero for each child, advance by
 * the configured stride, and exclude only hidden bit zero. The GUI alignment
 * configuration uses stride one. Evaluator routing belongs to the caller.
 * Two bounded passes avoid a temporary ordinary-JavaScript ID array.
 */
export function nativeGlobalRawTargetIds(
  count: number,
  flags?: Uint32Array,
  stride = 1,
): Uint32Array {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 0xffffffff ||
    !Number.isInteger(stride) ||
    stride < 1 ||
    stride > 0xffffffff ||
    (flags !== undefined &&
      (!(flags instanceof Uint32Array) || flags.length !== count))
  )
    throw Error(
      "Raw target records require a uint32 count, positive uint32 stride and matching uint32 flags.",
    );
  let admitted = flags ? 0 : Math.ceil(count / stride);
  if (flags)
    for (let id = 0; id < count; id += stride) if (!(flags[id] & 1)) admitted++;
  const ids = new Uint32Array(admitted);
  let next = 0;
  for (let id = 0; id < count; id += stride)
    if (!flags || !(flags[id] & 1)) ids[next++] = id;
  return ids;
}
