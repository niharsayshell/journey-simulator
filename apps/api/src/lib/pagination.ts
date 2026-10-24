import { paginationQuery } from "@js/shared";
import { parse } from "./errors";

/** Cursor pagination over cuid ids (newest first by createdAt, id as tiebreaker). */
export function pageArgs(query: unknown) {
  const { limit, cursor } = parse(paginationQuery.passthrough(), query);
  return {
    limit,
    prisma: { take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) },
  };
}

export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
