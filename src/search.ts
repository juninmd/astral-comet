import { FipeService, NamedCode } from './fipe_service';

// Big brands have 1000+ models; rendering them all would freeze the page.
export const MAX_VISIBLE = 50;

/** Options containing every query token (accent/case-insensitive); prefix matches first, then shorter names. An empty query keeps the catalog order. */
export function filterOptions(options: NamedCode[], query: string, limit = MAX_VISIBLE): { items: NamedCode[]; total: number } {
  const tokens = FipeService.normalize(query).split(' ').filter(Boolean);

  const matches = options
    .map((option, order) => ({ option, order, name: FipeService.normalize(option.name) }))
    .filter(x => tokens.every(t => x.name.includes(t)))
    .map(x => ({ ...x, prefix: tokens.length > 0 && x.name.startsWith(tokens[0]) ? 0 : 1 }))
    .sort((a, b) => a.prefix - b.prefix || (tokens.length ? a.name.length - b.name.length : 0) || a.order - b.order);

  return { items: matches.slice(0, limit).map(x => x.option), total: matches.length };
}

/** Next highlighted row for a listbox key press; -1 when the list is empty. */
export function nextActiveIndex(current: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End', count: number): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1) % count;
  return current <= 0 ? count - 1 : current - 1;
}
