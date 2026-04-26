// Mirrors the backend's pagination envelope (src/lib/pagination.ts). Cursor is
// the id of the last returned row; null when the page is the final one.
export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}
