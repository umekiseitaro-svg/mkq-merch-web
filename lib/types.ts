export type Item = {
  id: string;
  category: string;
  name: string;
  color: string;
  size: string;
  price: number;
};

export type Stock = {
  before: number | null;
  after: number | null;
  gifted: number;
};

export type Event = {
  id: string;
  label: string;
  date: string;
  items: Item[];
  stock: Record<string, Stock>;
  seriesId: string | null;
};

export type Series = {
  id: string;
  name: string;
};

export type AppState = {
  events: Event[];
  activeEventId: string | null;
  series: Series[];
};

/** Minimal structural check -- this is server-trusted-input territory
 * (only session-authenticated staff can write), so we validate shape
 * enough to avoid crashing the store, not every field's semantics. */
export function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.events)) return false;
  if (v.activeEventId !== null && typeof v.activeEventId !== "string") return false;
  if (v.series !== undefined && !Array.isArray(v.series)) return false;
  return true;
}
