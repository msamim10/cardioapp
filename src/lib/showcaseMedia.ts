export const SHOWCASE_MEDIA_ASPECT_RATIO = 9 / 16;

export type ShowcasePreviewStatus = 'loading' | 'ready' | 'error';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShowcaseGridLayout = {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  contentWidth: number;
  contentHeight: number;
};

/**
 * A "wall of players" grid. Tiles are laid out in a fixed 3 columns and sized to
 * fill the available area, clamped between square and portrait so the grid reads
 * as many tiny simultaneous clips without clipping on short phones. With 12
 * clips this yields a clean 4 rows × 3 columns (no orphan/partial row), which
 * fills a tall phone's vertical space better than a wide 4-across layout.
 */
export function getShowcaseGridLayout(
  availableWidth: number,
  availableHeight: number,
  tileCount: number,
  gap = 8,
): ShowcaseGridLayout {
  if (availableWidth <= 0 || tileCount <= 0) {
    return { columns: 0, rows: 0, tileWidth: 0, tileHeight: 0, gap, contentWidth: 0, contentHeight: 0 };
  }

  const columns = 3;
  const rows = Math.ceil(tileCount / columns);
  const tileWidth = Math.floor((availableWidth - gap * (columns - 1)) / columns);

  // Prefer filling the available height, but keep every tile between square and
  // a gentle portrait so 9:16 clips (contentFit: cover) never distort or clip.
  const minTileHeight = tileWidth;
  const maxTileHeight = Math.round(tileWidth * 1.5);
  const fitHeight =
    availableHeight > 0 ? Math.floor((availableHeight - gap * (rows - 1)) / rows) : maxTileHeight;
  const tileHeight = Math.min(Math.max(fitHeight, minTileHeight), maxTileHeight);

  return {
    columns,
    rows,
    tileWidth: Math.max(0, tileWidth),
    tileHeight: Math.max(0, tileHeight),
    gap,
    contentWidth: columns * tileWidth + gap * (columns - 1),
    contentHeight: rows * tileHeight + gap * (rows - 1),
  };
}

/** Row/column and pixel offset of a tile within the grid content box. */
export function getTilePosition(
  index: number,
  layout: Pick<ShowcaseGridLayout, 'columns' | 'tileWidth' | 'tileHeight' | 'gap'>,
): { row: number; col: number; x: number; y: number } {
  const columns = Math.max(1, layout.columns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    row,
    col,
    x: col * (layout.tileWidth + layout.gap),
    y: row * (layout.tileHeight + layout.gap),
  };
}

/**
 * Concurrency cap. Many simultaneous expo-video decoders crash on device, so
 * only a spread-out subset of tiles ever mount a real player; the rest stay on
 * their poster image. The selection is evenly distributed across the wall (and
 * always includes tile 0, the hero's landing slot) so the grid still reads as
 * "lots of people playing" rather than a clustered few.
 */
export function selectPlayingTileIndices(tileCount: number, cap: number): number[] {
  if (tileCount <= 0 || cap <= 0) return [];
  const count = Math.min(cap, tileCount);
  const picked = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    picked.add(Math.min(tileCount - 1, Math.round((i * tileCount) / count)));
  }
  // Rounding collisions can leave us below the cap; backfill with the next free
  // slots so we always run exactly `count` decoders.
  for (let i = 0; picked.size < count && i < tileCount; i += 1) {
    picked.add(i);
  }
  return Array.from(picked).sort((a, b) => a - b);
}

/**
 * Transform that makes a view (laid out at `target`) visually appear at
 * `appearAs`. Used for both the hero shrink-into-grid intro and the
 * tap-to-expand zoom, driven by a single interpolated progress value.
 */
export function getRectAppearanceTransform(
  target: Rect,
  appearAs: Rect,
): { scaleX: number; scaleY: number; translateX: number; translateY: number } {
  const scaleX = target.width > 0 ? appearAs.width / target.width : 1;
  const scaleY = target.height > 0 ? appearAs.height / target.height : 1;
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const appearCx = appearAs.x + appearAs.width / 2;
  const appearCy = appearAs.y + appearAs.height / 2;
  return {
    scaleX,
    scaleY,
    translateX: appearCx - targetCx,
    translateY: appearCy - targetCy,
  };
}

/**
 * Every tile owns a stable player and plays as soon as its source is ready and
 * the screen lifecycle (focused + foreground, and not eclipsed by an expanded
 * tile) permits it. Playback never depends on scroll position.
 */
export function shouldPreviewPlay(
  status: ShowcasePreviewStatus,
  lifecycleAllowsPlayback: boolean,
): boolean {
  return status === 'ready' && lifecycleAllowsPlayback;
}

/**
 * Generation guard for a tile's async source load: an in-flight replaceAsync
 * must never touch its native player after unmount or after a newer load
 * (retry / source swap) superseded it.
 */
export function isPreviewLoadCurrent(
  mounted: boolean,
  generation: number,
  currentGeneration: number,
): boolean {
  return mounted && generation === currentGeneration;
}
