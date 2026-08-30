import assert from 'node:assert/strict';
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { getCarouselItemOffset, getShowcaseCarouselLayout, isPreviewLoadCurrent, resolveActiveIndex, sameIndices, selectMountedIndices, selectPlayingIndices, shouldPreviewPlay, SHOWCASE_MEDIA_ASPECT_RATIO } from '../src/lib/showcaseMedia.ts';

const CLIP_COUNT = 12;
const GUTTER = 12; // spacing.md
const PRELOAD_RADIUS = 1;
const MAX_PLAYING = 2;
// itemVisiblePercentThreshold, as a fraction.
const VIEWABILITY_THRESHOLD = 0.6;
const MIN_PEEK = 26;

const VIEWPORTS: [number, number][] = [
  [320, 300],
  [320, 480],
  [375, 460],
  [393, 500],
  [430, 620],
  [744, 900], // iPad-ish: the width cap, not the height, must bind here
];

/**
 * Visible fraction of one snap cell at a given scroll offset. This is exactly
 * what FlatList's `itemVisiblePercentThreshold` measures, so the playback gate
 * can be reasoned about straight from the layout numbers.
 */
function visibleFraction(
  index: number,
  offset: number,
  layout: { sidePadding: number; itemWidth: number },
  viewportWidth: number,
): number {
  const left = layout.sidePadding + index * layout.itemWidth;
  const right = left + layout.itemWidth;
  const overlap = Math.max(0, Math.min(right, offset + viewportWidth) - Math.max(left, offset));
  return overlap / layout.itemWidth;
}

function cardsAlwaysFitAndNeighboursAlwaysPeek() {
  for (const [width, height] of VIEWPORTS) {
    const layout = getShowcaseCarouselLayout(width, height, GUTTER);
    const at = `${width}x${height}`;
    assert.ok(layout.cardWidth > 0 && layout.cardHeight > 0, `a card must render at ${at}`);
    assert.ok(layout.cardHeight <= height, `the card must not overflow the rail at ${at}`);
    assert.ok(layout.cardWidth < width, `the card must leave room for its neighbours at ${at}`);
    // The peek is the only remaining "the set keeps going" cue now that the
    // tile wall is gone, so it can never collapse to zero.
    assert.ok(layout.peek >= MIN_PEEK, `neighbours must peek by at least ${MIN_PEEK}px at ${at}`);
    // 9:16 framing is preserved so full-body shots never lose heads or feet.
    const aspect = layout.cardWidth / layout.cardHeight;
    assert.ok(
      Math.abs(aspect - SHOWCASE_MEDIA_ASPECT_RATIO) < 0.01,
      `the card must keep the clips' 9:16 framing at ${at}`,
    );
    assert.equal(layout.itemWidth, layout.cardWidth + layout.gutter, `snap cell is card + gutter at ${at}`);
  }
}

function unmeasuredCarouselIsSafe() {
  for (const [width, height] of [
    [0, 0],
    [0, 500],
    [393, 0],
  ] as [number, number][]) {
    const layout = getShowcaseCarouselLayout(width, height, GUTTER);
    assert.equal(layout.cardWidth, 0, 'an unmeasured rail renders nothing');
    assert.equal(layout.itemWidth, 0, 'an unmeasured rail has no snap interval');
    assert.equal(layout.sidePadding, 0, 'an unmeasured rail has no padding');
  }
}

function snapOffsetsCentreEveryCard() {
  for (const [width, height] of VIEWPORTS) {
    const layout = getShowcaseCarouselLayout(width, height, GUTTER);
    const at = `${width}x${height}`;
    for (let index = 0; index < CLIP_COUNT; index += 1) {
      const offset = getCarouselItemOffset(index, layout.itemWidth);
      assert.equal(offset % layout.itemWidth, 0, `offset ${index} is a snapToInterval multiple at ${at}`);
      // Snapping to a multiple of the interval must park the card dead centre,
      // which is only true because sidePadding is derived from itemWidth.
      const cardLeft = layout.sidePadding + index * layout.itemWidth + layout.gutter / 2;
      const cardCentre = cardLeft + layout.cardWidth / 2 - offset;
      assert.ok(
        Math.abs(cardCentre - width / 2) < 1e-6,
        `card ${index} must land dead centre at ${at} (got ${cardCentre}, want ${width / 2})`,
      );
    }
    // The first and last cards must be reachable: the scrollable extent has to
    // land exactly on offset 0 and on the last card's snap point, or the ends
    // of the reel sit off-centre.
    const contentWidth = 2 * layout.sidePadding + CLIP_COUNT * layout.itemWidth;
    const maxOffset = contentWidth - width;
    assert.ok(
      Math.abs(maxOffset - getCarouselItemOffset(CLIP_COUNT - 1, layout.itemWidth)) < 1e-6,
      `the last card must be reachable and centred at ${at}`,
    );
  }
}

function viewabilityIsolatesTheSnappedCard() {
  for (const [width, height] of VIEWPORTS) {
    const layout = getShowcaseCarouselLayout(width, height, GUTTER);
    const at = `${width}x${height}`;
    for (const index of [0, 5, CLIP_COUNT - 1]) {
      const offset = getCarouselItemOffset(index, layout.itemWidth);
      assert.ok(
        visibleFraction(index, offset, layout, width) >= 0.999,
        `the snapped card is fully visible at ${at}`,
      );
      for (const neighbour of [index - 1, index + 1]) {
        if (neighbour < 0 || neighbour >= CLIP_COUNT) continue;
        assert.ok(
          visibleFraction(neighbour, offset, layout, width) < VIEWABILITY_THRESHOLD,
          `a peeking neighbour must stay below the playback threshold at ${at}`,
        );
      }
    }
  }
}

function noMoreThanTwoCardsCanEverBeVisible() {
  // Mid-gesture two cards straddle the threshold, which is wanted so the
  // incoming card is already moving as it slides in. Three never can, which is
  // what keeps MAX_PLAYING an honest cap rather than a lucky one.
  for (const [width, height] of VIEWPORTS) {
    const layout = getShowcaseCarouselLayout(width, height, GUTTER);
    const steps = 40;
    for (let step = 0; step <= steps * (CLIP_COUNT - 1); step += 1) {
      const offset = (step / steps) * layout.itemWidth;
      let above = 0;
      for (let index = 0; index < CLIP_COUNT; index += 1) {
        if (visibleFraction(index, offset, layout, width) >= VIEWABILITY_THRESHOLD) above += 1;
      }
      assert.ok(
        above <= MAX_PLAYING,
        `at most ${MAX_PLAYING} cards may clear the threshold at ${width}x${height} (offset ${offset} had ${above})`,
      );
    }
  }
}

function preloadWindowCapsMountedDecoders() {
  const cap = PRELOAD_RADIUS * 2 + 1;
  for (let center = 0; center < CLIP_COUNT; center += 1) {
    const window = selectMountedIndices(center, CLIP_COUNT, PRELOAD_RADIUS);
    assert.ok(window.length <= cap, `no more than ${cap} players are ever mounted`);
    assert.ok(window.includes(center), 'the settled card always owns a player');
    assert.equal(new Set(window).size, window.length, 'a card never mounts two players');
    assert.ok(
      window.every((index) => index >= 0 && index < CLIP_COUNT),
      'the preload window never runs off the ends of the reel',
    );
  }
  // Neighbour preloading is the whole point: landing on the next card must find
  // it already buffered rather than blank.
  assert.deepEqual(selectMountedIndices(0, CLIP_COUNT, PRELOAD_RADIUS), [0, 1], 'the first card preloads its right neighbour');
  assert.deepEqual(
    selectMountedIndices(CLIP_COUNT - 1, CLIP_COUNT, PRELOAD_RADIUS),
    [CLIP_COUNT - 2, CLIP_COUNT - 1],
    'the last card preloads its left neighbour',
  );
  assert.deepEqual(selectMountedIndices(6, CLIP_COUNT, PRELOAD_RADIUS), [5, 6, 7], 'a middle card preloads both sides');
  assert.deepEqual(selectMountedIndices(4, 0, PRELOAD_RADIUS), [], 'an empty reel mounts nothing');
  assert.deepEqual(selectMountedIndices(99, CLIP_COUNT, PRELOAD_RADIUS), [10, 11], 'an out-of-range centre is clamped');
}

function onlyVisibleCardsPlay() {
  assert.deepEqual(selectPlayingIndices([3], 3, MAX_PLAYING), [3], 'at rest exactly one card plays');
  assert.deepEqual(selectPlayingIndices([3, 4], 3, MAX_PLAYING), [3, 4], 'mid-swipe both visible cards play');
  assert.deepEqual(selectPlayingIndices([], 3, MAX_PLAYING), [], 'nothing visible means nothing plays');
  // A fling can report a burst of items; the cap must hold and must keep the
  // cards nearest the active one rather than an arbitrary prefix.
  assert.deepEqual(
    selectPlayingIndices([0, 1, 6, 7, 8, 11], 7, MAX_PLAYING),
    [6, 7],
    'a fling never spins up more than the cap, and keeps the nearest cards',
  );
  assert.deepEqual(selectPlayingIndices([2, 2, 3], 2, MAX_PLAYING), [2, 3], 'duplicate tokens never double a decoder');
}

function activeCardDoesNotFlickerMidSwipe() {
  assert.equal(resolveActiveIndex([], 4), 4, 'an empty viewability tick changes nothing');
  assert.equal(resolveActiveIndex([4], 4), 4, 'the snapped card stays active');
  // Both cards are viewable through the middle of the gesture; holding the
  // previous one stops the counter bouncing 03/04/03 within a single swipe.
  assert.equal(resolveActiveIndex([4, 5], 4), 4, 'the outgoing card holds while both are visible');
  assert.equal(resolveActiveIndex([5], 4), 5, 'the incoming card takes over once the old one leaves');
  assert.equal(resolveActiveIndex([9, 10], 2), 9, 'after a fling the nearest visible card becomes active');
}

function redundantViewabilityTicksDoNotRerender() {
  assert.equal(sameIndices([3, 4], [3, 4]), true, 'an unchanged playing set is recognised');
  assert.equal(sameIndices([3], [3, 4]), false, 'a widened playing set is a change');
  assert.equal(sameIndices([3, 4], [4, 5]), false, 'a shifted playing set is a change');
  assert.equal(sameIndices([], []), true, 'two empty sets match');
}

function playbackRespectsLifecycleAndReadiness() {
  assert.equal(shouldPreviewPlay('ready', true), true, 'a ready, visible card plays');
  assert.equal(shouldPreviewPlay('ready', false), false, 'blur, background or off-screen pauses a card');
  assert.equal(shouldPreviewPlay('loading', true), false, 'a buffering card stays on its poster');
  assert.equal(shouldPreviewPlay('error', true), false, 'a failed card never attempts playback');
}

function unmountAndStaleLoadSafety() {
  assert.equal(isPreviewLoadCurrent(true, 5, 5), true, "a card's current load may configure its player");
  assert.equal(
    isPreviewLoadCurrent(false, 5, 5),
    false,
    'an in-flight replaceAsync must not touch a player after unmount (no NativeSharedObjectNotFoundException)',
  );
  assert.equal(
    isPreviewLoadCurrent(true, 4, 5),
    false,
    'a stale load generation must remain inert once the preload window moved on',
  );
}

cardsAlwaysFitAndNeighboursAlwaysPeek();
unmeasuredCarouselIsSafe();
snapOffsetsCentreEveryCard();
viewabilityIsolatesTheSnappedCard();
noMoreThanTwoCardsCanEverBeVisible();
preloadWindowCapsMountedDecoders();
onlyVisibleCardsPlay();
activeCardDoesNotFlickerMidSwipe();
redundantViewabilityTicksDoNotRerender();
playbackRespectsLifecycleAndReadiness();
unmountAndStaleLoadSafety();
console.log(
  'Showcase lifecycle replay passed: one 9:16 card centred per snap with guaranteed neighbour peek, snap offsets that centre every card including the ends, viewability that isolates the snapped card (never more than 2 visible at once), a 3-player preload window, visible-only playback with lifecycle gating, non-flickering active index, and unmount/stale-load safety',
);
