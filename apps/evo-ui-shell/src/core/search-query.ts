export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

export function canRunSearch(query: string): boolean {
  return normalizeSearchQuery(query).length > 0;
}
