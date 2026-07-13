/**
 * Video source layer.
 *
 * Full-length runner videos are streamed as HLS adaptive-bitrate ladders from
 * Firebase Storage / GCS. Phone uses vertical; TV mode uses horizontal.
 *
 * Config: EXPO_PUBLIC_MEDIA_BASE_URL=https://storage.googleapis.com/<bucket>
 */

export type Orientation = 'vertical' | 'horizontal';

const BASE_URL = (process.env.EXPO_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/$/, '');
const HLS_PREFIX = 'hls';

type MediaEntry = {
  slug: string;
  verticalUrl?: string;
  horizontalUrl?: string;
  poster?: string;
  /**
   * Orientations with no hosted source. A missing orientation falls back to the
   * other orientation's stream; if both are missing the source resolves to null
   * and the workout screen shows its "not available yet" state.
   */
  missing?: Orientation[];
};

/** Maps game level ids to storage folders level1..level12 (ordered source set). */
const LEVEL_MEDIA: Record<string, MediaEntry> = {
  'jurassic-escape': { slug: 'level1' },
  'godzilla-kong': { slug: 'level2' },
  'kpop-demon': { slug: 'level3' },
  'subway-surfers': { slug: 'level4' },
  // Digital Circus: vertical source corrupt/unavailable -> serve horizontal.
  'digital-circus': { slug: 'level5', missing: ['vertical'] },
  // Frozen Escape: no usable source yet.
  'frozen-escape': { slug: 'level6', missing: ['vertical', 'horizontal'] },
  // Minecraft Nether: no usable source yet.
  'minecraft-nether': { slug: 'level7', missing: ['vertical', 'horizontal'] },
  // Toy Story: no usable source yet.
  'toy-story': { slug: 'level8', missing: ['vertical', 'horizontal'] },
  // Zootopia: horizontal source missing -> serve vertical.
  zootopia: { slug: 'level9', missing: ['horizontal'] },
  'minecraft-subway': { slug: 'level10' },
  'mario-world': { slug: 'level11' },
  'stranger-things': { slug: 'level12' },
  // 4K quality test source (2160p ladder).
  '4k-test': { slug: 'level13' },
};

function masterUrl(slug: string, orientation: Orientation): string {
  return `${BASE_URL}/${HLS_PREFIX}/${slug}/${orientation}/master.m3u8`;
}

/** Resolve the orientation to actually stream, falling back when one is missing. */
function resolveOrientation(entry: MediaEntry, requested: Orientation): Orientation | null {
  const missing = entry.missing ?? [];
  if (!missing.includes(requested)) return requested;
  const other: Orientation = requested === 'vertical' ? 'horizontal' : 'vertical';
  return missing.includes(other) ? null : other;
}

export function getVideoSource(
  levelId: string | undefined,
  orientation: Orientation
): string | null {
  if (!levelId) return null;
  const entry = LEVEL_MEDIA[levelId];
  if (!entry) return null;

  const resolved = resolveOrientation(entry, orientation);
  if (!resolved) return null;

  const override = resolved === 'vertical' ? entry.verticalUrl : entry.horizontalUrl;
  if (override) return override;

  if (!BASE_URL) return null;
  return masterUrl(entry.slug, resolved);
}

export function getPoster(levelId: string | undefined): string | null {
  if (!levelId) return null;
  return LEVEL_MEDIA[levelId]?.poster ?? null;
}

export function hasVideo(levelId: string | undefined): boolean {
  return !!levelId && levelId in LEVEL_MEDIA;
}

export const isMediaConfigured = BASE_URL.length > 0;
