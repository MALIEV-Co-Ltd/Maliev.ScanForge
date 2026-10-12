/** Recovered bounds-cache accessor; callbacks may replace the stored context. */
export function accessGuideBoundsContext<Context>(
  holder: { context: Context },
  update: boolean,
  valid: (context: Context) => boolean,
  initialize: (context: Context) => void,
): Context {
  if (update && !valid(holder.context)) initialize(holder.context);
  return holder.context;
}
