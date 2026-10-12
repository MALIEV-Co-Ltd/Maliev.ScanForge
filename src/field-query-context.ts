/** Recovered lazy accessor; validity checking and initialization may replace the context. */
export function accessGuideQueryContext<
  Owner,
  Context extends { owner: Owner | null },
>(
  holder: { context: Context },
  owner: Owner,
  update: boolean,
  valid: (context: Context) => boolean,
  initialize: (context: Context) => void,
): Context {
  if (!update) return holder.context;
  const ready = valid(holder.context);
  if (!ready) {
    holder.context.owner = owner;
    initialize(holder.context);
  }
  return holder.context;
}
