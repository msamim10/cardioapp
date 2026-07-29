import assert from 'node:assert/strict';
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { getRectAppearanceTransform, getShowcaseGridLayout, getTilePosition, isPreviewLoadCurrent, selectPlayingTileIndices, shouldPreviewPlay } from '../src/lib/showcaseMedia.ts';

const TILE_COUNT = 12; // 4 original + 8 new gameplay clips = a clean 4-row × 3-column grid
const CAP = 6; // MAX_CONCURRENT_TILE_PLAYERS

function gridFitsShortAndNarrowScreens() {
  const viewports: [number, number][] = [
    [320, 360],
    [320, 480],
    [375, 520],
    [393, 560],
    [430, 640],
  ];
  for (const [width, height] of viewports) {
    const layout = getShowcaseGridLayout(width, height, TILE_COUNT);
    assert.equal(layout.columns, 3, `grid should use exactly 3 columns at ${width}x${height}`);
    assert.equal(layout.rows, 4, `12 tiles must form exactly 4 full rows at ${width}x${height}`);
    assert.ok(layout.tileWidth > 0 && layout.tileHeight > 0, `tiles must render at ${width}x${height}`);
    assert.ok(layout.contentWidth <= width, `grid must not exceed width at ${width}x${height}`);
    assert.equal(layout.rows, Math.ceil(TILE_COUNT / layout.columns), 'rows derive from count/columns');
    // Every tile stays between square and gentle portrait so 9:16 cover clips
    // never distort or clip.
    assert.ok(
      layout.tileHeight >= layout.tileWidth && layout.tileHeight <= Math.round(layout.tileWidth * 1.5),
      `tile aspect must stay between 1:1 and ~2:3 at ${width}x${height}`,
    );
  }
}

function unmeasuredGridIsSafe() {
  const layout = getShowcaseGridLayout(0, 0, TILE_COUNT);
  assert.equal(layout.tileWidth, 0, 'an unmeasured grid renders nothing');
  assert.equal(layout.contentWidth, 0, 'an unmeasured grid has no content box');
}

function concurrencyCapSpreadsAcrossTheWall() {
  const live = selectPlayingTileIndices(TILE_COUNT, CAP);
  assert.equal(live.length, CAP, 'exactly CAP tiles mount a real decoder');
  assert.equal(new Set(live).size, CAP, 'live tiles are unique (no doubled decoder)');
  assert.ok(
    live.every((index) => index >= 0 && index < TILE_COUNT),
    'live tile indices stay within the wall',
  );
  assert.ok(live.includes(0), "the hero's landing slot (tile 0) always plays");
  // Spread: the live tiles should not be clustered into the first CAP slots.
  assert.ok(Math.max(...live) >= TILE_COUNT - 3, 'live tiles reach the far end of the wall');
}

function capNeverExceedsTileCount() {
  const live = selectPlayingTileIndices(3, CAP);
  assert.equal(live.length, 3, 'cap is clamped to the number of tiles');
  assert.deepEqual(selectPlayingTileIndices(0, CAP), [], 'no tiles means no decoders');
  assert.deepEqual(selectPlayingTileIndices(TILE_COUNT, 0), [], 'a zero cap disables playback');
}

function heroLandsCleanlyInSlotZero() {
  const layout = getShowcaseGridLayout(393, 560, TILE_COUNT);
  const pos = getTilePosition(0, layout);
  assert.deepEqual([pos.row, pos.col], [0, 0], 'tile 0 sits at the top-left slot');
  const heroRect = { x: 20, y: 10, width: 300, height: 520 };
  const slotZero = { x: pos.x, y: pos.y, width: layout.tileWidth, height: layout.tileHeight };
  const t = getRectAppearanceTransform(heroRect, slotZero);
  // The shrink transform must scale the big hero down to the small tile, and
  // the docked center must coincide with the tile center (clean landing).
  assert.ok(t.scaleX > 0 && t.scaleX < 1, 'hero scales down horizontally into its slot');
  assert.ok(t.scaleY > 0 && t.scaleY < 1, 'hero scales down vertically into its slot');
  const dockedCx = heroRect.x + heroRect.width / 2 + t.translateX;
  const dockedCy = heroRect.y + heroRect.height / 2 + t.translateY;
  assert.ok(Math.abs(dockedCx - (slotZero.x + slotZero.width / 2)) < 1e-6, 'docked hero centers on slot X');
  assert.ok(Math.abs(dockedCy - (slotZero.y + slotZero.height / 2)) < 1e-6, 'docked hero centers on slot Y');
}

function expandZoomIsReversible() {
  const full = { x: 0, y: 0, width: 393, height: 852 };
  const tile = { x: 100, y: 300, width: 88, height: 132 };
  const t = getRectAppearanceTransform(full, tile);
  // At progress 0 the fullscreen card must appear exactly over the tapped tile.
  const appearCx = full.x + full.width / 2 + t.translateX;
  const appearCy = full.y + full.height / 2 + t.translateY;
  assert.ok(Math.abs(appearCx - (tile.x + tile.width / 2)) < 1e-6, 'collapsed card centers on the tile X');
  assert.ok(Math.abs(appearCy - (tile.y + tile.height / 2)) < 1e-6, 'collapsed card centers on the tile Y');
  assert.ok(t.scaleX > 0 && t.scaleX < 1, 'card starts scaled down to the tile');
  const degenerate = getRectAppearanceTransform({ x: 0, y: 0, width: 0, height: 0 }, tile);
  assert.equal(degenerate.scaleX, 1, 'a zero-size target never divides by zero');
}

function tilesPlayWithLifecycleAndPauseWhenEclipsed() {
  // Grid tiles play only while focused + foregrounded AND no tile is expanded.
  assert.equal(shouldPreviewPlay('ready', true), true, 'ready tiles play when the grid is active');
  assert.equal(shouldPreviewPlay('ready', false), false, 'blur/background/expanded pauses every tile');
  assert.equal(shouldPreviewPlay('loading', true), false, 'a still-loading tile stays on its poster');
  assert.equal(shouldPreviewPlay('error', true), false, 'a failed tile never attempts playback');
}

function partialErrorIsolation() {
  const statuses = ['ready', 'error', 'ready', 'ready', 'ready', 'ready'] as const;
  assert.deepEqual(
    statuses.map((status) => shouldPreviewPlay(status, true)),
    [true, false, true, true, true, true],
    'a single failed decoder must not pause the healthy tiles',
  );
}

function unmountAndStaleLoadSafety() {
  assert.equal(isPreviewLoadCurrent(true, 5, 5), true, "a tile's current load may configure its player");
  assert.equal(
    isPreviewLoadCurrent(false, 5, 5),
    false,
    'an in-flight replaceAsync must not touch a player after unmount (no NativeSharedObjectNotFoundException)',
  );
  assert.equal(
    isPreviewLoadCurrent(true, 4, 5),
    false,
    'a stale load generation (e.g. after a focus-player source swap) must remain inert',
  );
}

gridFitsShortAndNarrowScreens();
unmeasuredGridIsSafe();
concurrencyCapSpreadsAcrossTheWall();
capNeverExceedsTileCount();
heroLandsCleanlyInSlotZero();
expandZoomIsReversible();
tilesPlayWithLifecycleAndPauseWhenEclipsed();
partialErrorIsolation();
unmountAndStaleLoadSafety();
console.log(
  'Showcase lifecycle replay passed: clean 4-row x 3-column tile wall, spread concurrency cap (6 of 12 decoders), clean hero-shrink and reversible tap-to-expand geometry, lifecycle/eclipse pausing, partial-error isolation, and unmount/stale-load safety',
);
