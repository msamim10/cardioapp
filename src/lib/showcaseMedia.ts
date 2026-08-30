export const SHOWCASE_MEDIA_ASPECT_RATIO = 9 / 16;

export type ShowcasePreviewStatus = 'loading' | 'ready' | 'error';

export type ShowcaseCarouselLayout = {
  cardWidth: number;
  cardHeight: number;
  gutter: number;
  /** Width of one snap cell: the card plus one gutter. Also the snap interval. */
  itemWidth: number;
  /** Content padding that parks the snapped card dead centre in the viewport. */
  sidePadding: number;
  /** Visible width of each neighbouring card once a card is snapped. */
  peek: number;
};

/**
 * Neighbours must always show. The peek is what tells the user the reel keeps
 * going, which is the only thing left carrying the "lots of people are doing
 * this" signal now that the tile wall is gone.
 */
const MIN_PEEK = 26;
const MAX_WIDTH_FRACTION = 0.82;

/**
 * One large card at a time, centred, with both neighbours peeking.
 *
 * Cards keep the clips' native 9:16 framing rather than cropping to a squarer
 * card, because these are full-body shots and a vertical crop takes heads and
 * feet off. On a tall phone that makes height the binding constraint, which in
 * turn gives a generous peek for free.
 *
 * `itemWidth` is the snap interval, and `sidePadding` is derived from it, so
 * snapping to a multiple of the interval centres card N exactly — including the
 * first and last, whose scroll extents land precisely on 0 and (N-1)·interval.
 */
export function getShowcaseCarouselLayout(
  availableWidth: number,
  availableHeight: number,
  gutter = 12,
): ShowcaseCarouselLayout {
  if (availableWidth <= 0 || availableHeight <= 0) {
    return { cardWidth: 0, cardHeight: 0, gutter, itemWidth: 0, sidePadding: 0, peek: 0 };
  }

  const heightCapped = availableHeight * SHOWCASE_MEDIA_ASPECT_RATIO;
  const widthCapped = availableWidth * MAX_WIDTH_FRACTION;
  const peekCapped = availableWidth - 2 * (MIN_PEEK + gutter);
  const cardWidth = Math.floor(Math.max(0, Math.min(heightCapped, widthCapped, peekCapped)));
  const cardHeight = Math.floor(cardWidth / SHOWCASE_MEDIA_ASPECT_RATIO);
  const itemWidth = cardWidth + gutter;

  return {
    cardWidth,
    cardHeight,
    gutter,
    itemWidth,
    sidePadding: Math.max(0, (availableWidth - itemWidth) / 2),
    peek: Math.max(0, (availableWidth - cardWidth) / 2 - gutter),
  };
}

/** Scroll offset that centres a card. Feeds `getItemLayout`. */
export function getCarouselItemOffset(index: number, itemWidth: number): number {
  return index * itemWidth;
}

/**
 * Which cards keep a mounted native player. Only the settled card and its
 * immediate neighbours, so the next card is already buffered when the user
 * lands on it and the screen never holds more than three decoders.
 *
 * This is driven by the *settled* index rather than the live one so that no
 * native player is created or released while a finger is on the screen.
 */
export function selectMountedIndices(center: number, count: number, radius = 1): number[] {
  if (count <= 0) return [];
  const clamped = Math.min(Math.max(center, 0), count - 1);
  const indices: number[] = [];
  for (let index = clamped - radius; index <= clamped + radius; index += 1) {
    if (index >= 0 && index < count) indices.push(index);
  }
  return indices;
}

/**
 * Playback gate: only cards the viewability config reports as on screen play.
 * Mid-swipe two cards clear the threshold at once, which is wanted — the
 * incoming card is already moving as it slides in — but the result is capped so
 * a fast fling can never spin up more than `max` simultaneous decoders.
 */
export function selectPlayingIndices(viewable: number[], active: number, max = 2): number[] {
  if (viewable.length === 0) return [];
  const nearestFirst = Array.from(new Set(viewable)).sort(
    (a, b) => Math.abs(a - active) - Math.abs(b - active) || a - b,
  );
  return nearestFirst.slice(0, Math.max(1, max)).sort((a, b) => a - b);
}

/**
 * The card that owns the counter and the emphasis. Because two cards straddle
 * the visibility threshold in the middle of every swipe, holding the previous
 * card until it actually leaves keeps the counter from flickering back and
 * forth within a single gesture.
 */
export function resolveActiveIndex(viewable: number[], previous: number): number {
  if (viewable.length === 0) return previous;
  if (viewable.includes(previous)) return previous;
  return viewable.reduce((best, index) =>
    Math.abs(index - previous) < Math.abs(best - previous) ? index : best,
  );
}

/** Order-insensitive compare, so a viewability tick that changes nothing does not re-render. */
export function sameIndices(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * A card plays as soon as its source is ready and the screen lifecycle
 * (focused + foregrounded) plus its own visibility permit it.
 */
export function shouldPreviewPlay(
  status: ShowcasePreviewStatus,
  lifecycleAllowsPlayback: boolean,
): boolean {
  return status === 'ready' && lifecycleAllowsPlayback;
}

/**
 * Generation guard for a card's async source load: an in-flight replaceAsync
 * must never touch its native player after unmount or after a newer load
 * superseded it.
 */
export function isPreviewLoadCurrent(
  mounted: boolean,
  generation: number,
  currentGeneration: number,
): boolean {
  return mounted && generation === currentGeneration;
}
