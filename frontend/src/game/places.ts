import type { Kingdom } from '@soulbound/shared';

/** Stable place id: slugged name plus lowercase kingdom, e.g. "toll-bridge-kaldrath". */
export function slugPlaceId(name: string, kingdom: Kingdom): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'place';
  return `${slug}-${kingdom.toLowerCase()}`;
}
