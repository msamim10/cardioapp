/**
 * Composition plan: the pure-TS translation of a run recording log into the
 * exact list of edits and overlays the Swift composer performs. Everything
 * timing-related is decided here so it can be replayed in Node
 * (`npm run test:recording-log`); `modules/cardiosurf-composer` only executes
 * the plan (`AVMutableComposition` inserts, `scaleTimeRange`, Core Animation
 * keyframes) and stays dumb.
 *
 * Canvas: 720×1280 portrait. Game (the level's composite MP4, 720×576) on the
 * top 45%; camera (720×1280 selfie clip) cover-cropped into the bottom
 * 720×704 with a vertical bias toward the tracked body. All times are seconds
 * on the output timeline, whose zero is the first recorded camera frame.
 *
 * Timeline:
 *   [0, D)        run: game inserts per segment (play, scaled to the wall
 *                 range → 0.85/1.0/1.2× or whatever the ticks measured), the
 *                 last frame frozen across gaps; camera plays straight through
 *   [D, D + 4)    end card over a frozen last game frame (no camera)
 * where D = camera clip duration.
 */

import type { BeatmapMove } from '@/lib/beatmaps';
import type { CueGrade } from '@/lib/cueScoring';
import type { RunLogEvent, RunLogFile, RunLogSegment } from '@/lib/runRecordingLog';

export const PLAN_VERSION = 1 as const;

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export const CANVAS: Size = { width: 720, height: 1280 };
/** Top 45% of the canvas: the level's composite render (720×576 source, 1:1). */
export const GAME_REGION: Rect = { x: 0, y: 0, width: 720, height: 576 };
/** Bottom 55%: the selfie camera, cover-cropped. */
export const CAMERA_REGION: Rect = { x: 0, y: 576, width: 720, height: 704 };
/** Native recording frame (portrait connection, `.hd1280x720`). */
export const CAMERA_SOURCE: Size = { width: 720, height: 1280 };
/**
 * Clear of TikTok / Reels / Shorts chrome: right-side action rail, bottom
 * caption block, top navigation. Every HUD element and the watermark sit
 * inside this box.
 */
export const SAFE_ZONE = { minX: 40, maxX: 600, minY: 160, maxY: 960 } as const;
export const END_CARD_SEC = 4;
/** One frame of the 30 fps game asset — the source range a freeze insert stretches. */
export const FREEZE_FRAME_SEC = 1 / 30;
/** Duration of a PERFECT/GOOD/MISS pop. */
export const POP_SEC = 0.6;
/** Sub-millisecond gaps between segments are playback jitter, not freezes. */
const GAP_EPS_SEC = 0.001;

export type PlanInsert =
  | {
      kind: 'play';
      /** Source range of the game asset (seconds). */
      gameStart: number;
      gameEnd: number;
      /** Where it lands on the output timeline; `scaleTimeRange` maps one onto the other. */
      canvasStart: number;
      canvasEnd: number;
    }
  | {
      kind: 'freeze';
      /** The frame held (a `FREEZE_FRAME_SEC` source range starting here, stretched). */
      gameAt: number;
      canvasStart: number;
      canvasEnd: number;
    };

export type HudPop = { at: number; grade: CueGrade; text: string; deltaMs: number | null };
export type HudTextInterval = { start: number; end: number; text: string };
export type HudChevronInterval = { start: number; end: number; move: BeatmapMove };

export type PlanThemeColors = {
  accent: string;
  perfect: string;
  good: string;
  miss: string;
};

export type PlanEndCard = {
  levelName: string;
  score: number;
  accuracyPct: number;
  maxCombo: number;
  personalBest: boolean;
  cta: string;
  wordmark: string;
};

export type CompositionPlan = {
  version: typeof PLAN_VERSION;
  canvas: Size;
  gameRegion: Rect;
  cameraRegion: Rect;
  safeZone: typeof SAFE_ZONE;
  /** Total output length: camera duration + end card. */
  durationSec: number;
  /** Where the run footage ends and the end card begins. */
  runDurationSec: number;
  camera: {
    durationSec: number;
    source: Size;
    /** Source-space rect that fills `cameraRegion` (cover-crop with body bias). */
    cropRect: Rect;
    /** Where the bias came from, for diagnostics. */
    focusY: number;
  };
  inserts: PlanInsert[];
  hud: {
    pops: HudPop[];
    /** Anchor for pops (centre of the game region). */
    popCenter: { x: number; y: number };
    score: HudTextInterval[];
    combo: HudTextInterval[];
    /** Top-right inside the safe zone (right edge, baseline top). */
    scoreAnchor: { right: number; top: number };
    chevrons: HudChevronInterval[];
    chevronCenter: { x: number; y: number };
    watermark: { text: string; x: number; y: number };
  };
  endCard: PlanEndCard & { start: number; durationSec: number };
  theme: PlanThemeColors;
  audio: { includeGameAudio: boolean };
};

export type CompositionPlanInput = {
  /** Duration of the level's composite game asset. */
  gameDurationSec: number;
  /** Duration of the camera clip (from `stopRecording`, ms → s by the caller). */
  cameraDurationSec: number;
  cameraSource?: Size;
  theme: PlanThemeColors;
  endCard: Omit<PlanEndCard, 'cta' | 'wordmark'> & Partial<Pick<PlanEndCard, 'cta' | 'wordmark'>>;
  /** Default false: the owner has not confirmed music rights. */
  includeGameAudio?: boolean;
};

type Seg = { ws: number; we: number; vs: number; ve: number };

/** Segments → seconds, clipped to the camera clip and the game asset, sorted. */
export function normalizeSegments(
  segments: readonly RunLogSegment[],
  cameraDurationSec: number,
  gameDurationSec: number,
): Seg[] {
  const out: Seg[] = [];
  for (const raw of segments) {
    let ws = raw.ws / 1000;
    let we = raw.we / 1000;
    let vs = raw.vs;
    let ve = raw.ve;
    if (we <= ws || ve <= vs) continue;
    const slope = (ve - vs) / (we - ws); // video seconds per wall second
    if (ws < 0) {
      vs += -ws * slope;
      ws = 0;
    }
    if (we > cameraDurationSec) {
      ve = vs + (cameraDurationSec - ws) * slope;
      we = cameraDurationSec;
    }
    if (vs >= gameDurationSec) continue;
    if (ve > gameDurationSec) {
      we = ws + (gameDurationSec - vs) / slope;
      ve = gameDurationSec;
    }
    if (we - ws <= GAP_EPS_SEC || ve - vs <= 0) continue;
    out.push({ ws, we, vs, ve });
  }
  out.sort((a, b) => a.ws - b.ws);
  // Overlaps (a late tick re-anchoring) resolve in favour of the earlier segment.
  const merged: Seg[] = [];
  for (const seg of out) {
    const prev = merged[merged.length - 1];
    if (prev && seg.ws < prev.we) {
      if (seg.we <= prev.we) continue;
      const slope = (seg.ve - seg.vs) / (seg.we - seg.ws);
      merged.push({ ws: prev.we, we: seg.we, vs: seg.vs + (prev.we - seg.ws) * slope, ve: seg.ve });
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

function clampFreezeAt(at: number, gameDurationSec: number): number {
  return Math.max(0, Math.min(at, gameDurationSec - FREEZE_FRAME_SEC));
}

/**
 * Ordered game-track edits covering `[0, runDurationSec + END_CARD_SEC)`
 * with no gaps: play inserts per segment, freezes across pauses/stalls/seeks
 * and before the first segment, and one final freeze under the end card.
 */
export function planInserts(
  segments: readonly RunLogSegment[],
  cameraDurationSec: number,
  gameDurationSec: number,
): PlanInsert[] {
  const inserts: PlanInsert[] = [];
  const D = Math.max(0, cameraDurationSec);
  const segs = normalizeSegments(segments, D, gameDurationSec);
  let cursor = 0;
  let heldFrame = clampFreezeAt(segs[0]?.vs ?? 0, gameDurationSec);
  for (const seg of segs) {
    if (seg.ws > cursor + GAP_EPS_SEC) {
      inserts.push({ kind: 'freeze', gameAt: heldFrame, canvasStart: cursor, canvasEnd: seg.ws });
      cursor = seg.ws;
    }
    const canvasStart = Math.max(seg.ws, cursor);
    if (seg.we - canvasStart > GAP_EPS_SEC) {
      inserts.push({ kind: 'play', gameStart: seg.vs, gameEnd: seg.ve, canvasStart, canvasEnd: seg.we });
      cursor = seg.we;
    }
    heldFrame = clampFreezeAt(seg.ve, gameDurationSec);
  }
  if (D > cursor + GAP_EPS_SEC) {
    inserts.push({ kind: 'freeze', gameAt: heldFrame, canvasStart: cursor, canvasEnd: D });
    cursor = D;
  }
  inserts.push({ kind: 'freeze', gameAt: heldFrame, canvasStart: cursor, canvasEnd: cursor + END_CARD_SEC });
  return inserts;
}

/**
 * Cover-crop the 9:16 camera into the 720×704 region, biased vertically so
 * the tracked body (mean of head and hip height) sits at the region's centre.
 * Chosen over aspect-fit-with-blur: the phone usually stands on the floor or
 * a low shelf, so the body is off-centre and a plain centre crop cuts heads;
 * a blurred pillarbox would waste a third of the region on a near-square
 * frame and needs a second filtered layer per frame.
 */
export function cameraCropRect(
  source: Size,
  region: Rect,
  focusY: number,
): Rect {
  const scale = region.width / source.width;
  const cropHeight = Math.min(source.height, region.height / scale);
  const maxY = source.height - cropHeight;
  const centred = focusY * source.height - cropHeight / 2;
  const y = Math.max(0, Math.min(maxY, centred));
  return { x: 0, y: round2(y), width: source.width, height: round2(cropHeight) };
}

export function focusYFromLog(log: Pick<RunLogFile, 'pose'>): number {
  const pose = log.pose;
  if (!pose || pose.samples <= 0) return 0.5;
  const focus = (pose.headY + pose.hipY) / 2;
  return Number.isFinite(focus) ? Math.max(0, Math.min(1, focus)) : 0.5;
}

const GRADE_TEXT: Record<CueGrade, string> = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' };

/** HUD keyframes from the event log, restricted to the run footage `[0, D)`. */
export function planHud(events: readonly RunLogEvent[], runDurationSec: number) {
  const pops: HudPop[] = [];
  const score: HudTextInterval[] = [];
  const combo: HudTextInterval[] = [];
  const chevrons: HudChevronInterval[] = [];
  const D = runDurationSec;

  let scoreText = '0';
  let comboText = '';
  let stateSince = 0;
  const flushState = (until: number) => {
    if (until - stateSince <= GAP_EPS_SEC) return;
    score.push({ start: stateSince, end: until, text: scoreText });
    if (comboText) combo.push({ start: stateSince, end: until, text: comboText });
  };

  let chevron: { move: BeatmapMove; since: number } | null = null;
  const flushChevron = (until: number) => {
    if (chevron && until - chevron.since > GAP_EPS_SEC) {
      chevrons.push({ start: chevron.since, end: until, move: chevron.move });
    }
    chevron = null;
  };

  const sorted = events.slice().sort((a, b) => a.w - b.w);
  for (const event of sorted) {
    const at = event.w / 1000;
    if (at < 0 || at >= D) continue;
    if (event.k === 'j' || event.k === 'e') {
      pops.push({
        at: round3(at),
        grade: event.k === 'j' ? event.g : 'miss',
        text: GRADE_TEXT[event.k === 'j' ? event.g : 'miss'],
        deltaMs: event.k === 'j' ? event.d : null,
      });
      flushState(at);
      scoreText = String(event.s);
      comboText = event.c >= 2 ? `${event.c}x` : '';
      stateSince = at;
    } else if (event.k === 'u') {
      flushChevron(at);
      if (event.m) chevron = { move: event.m, since: at };
    }
  }
  flushState(D);
  flushChevron(D);
  return { pops, score, combo, chevrons };
}

export function buildCompositionPlan(log: RunLogFile, input: CompositionPlanInput): CompositionPlan {
  const gameDurationSec = Math.max(FREEZE_FRAME_SEC, input.gameDurationSec);
  const logCamera = log.recording.cameraDurationMs;
  const cameraDurationSec = round3(
    Math.max(
      0,
      input.cameraDurationSec > 0 ? input.cameraDurationSec : logCamera !== null ? logCamera / 1000 : 0,
    ),
  );
  const source = input.cameraSource ?? CAMERA_SOURCE;
  const focusY = focusYFromLog(log);
  const inserts = planInserts(log.segments, cameraDurationSec, gameDurationSec);
  const hud = planHud(log.events, cameraDurationSec);
  const summary = log.summary;

  return {
    version: PLAN_VERSION,
    canvas: { ...CANVAS },
    gameRegion: { ...GAME_REGION },
    cameraRegion: { ...CAMERA_REGION },
    safeZone: SAFE_ZONE,
    durationSec: round3(cameraDurationSec + END_CARD_SEC),
    runDurationSec: cameraDurationSec,
    camera: {
      durationSec: cameraDurationSec,
      source: { ...source },
      cropRect: cameraCropRect(source, CAMERA_REGION, focusY),
      focusY: round3(focusY),
    },
    inserts: inserts.map(roundInsert),
    hud: {
      ...hud,
      popCenter: { x: GAME_REGION.x + GAME_REGION.width / 2, y: 330 },
      scoreAnchor: { right: SAFE_ZONE.maxX, top: SAFE_ZONE.minY },
      chevronCenter: { x: GAME_REGION.x + GAME_REGION.width / 2, y: 490 },
      watermark: { text: 'CARDIOSURF', x: SAFE_ZONE.minX, y: SAFE_ZONE.minY },
    },
    endCard: {
      start: cameraDurationSec,
      durationSec: END_CARD_SEC,
      levelName: input.endCard.levelName,
      score: Math.round(input.endCard.score ?? summary?.totalScore ?? 0),
      accuracyPct: Math.round(input.endCard.accuracyPct),
      maxCombo: Math.round(input.endCard.maxCombo),
      personalBest: input.endCard.personalBest,
      cta: input.endCard.cta ?? 'Beat my score',
      wordmark: input.endCard.wordmark ?? 'CARDIOSURF',
    },
    theme: { ...input.theme },
    audio: { includeGameAudio: input.includeGameAudio === true },
  };
}

/** Invariants the Swift side relies on; throws with a reason when violated. */
export function validateCompositionPlan(plan: CompositionPlan): void {
  let cursor = 0;
  for (const insert of plan.inserts) {
    if (Math.abs(insert.canvasStart - cursor) > GAP_EPS_SEC * 10) {
      throw new Error(`insert gap at ${cursor}s → ${insert.canvasStart}s`);
    }
    if (insert.canvasEnd <= insert.canvasStart) throw new Error('empty insert');
    if (insert.kind === 'play' && insert.gameEnd <= insert.gameStart) throw new Error('empty play range');
    cursor = insert.canvasEnd;
  }
  if (Math.abs(cursor - plan.durationSec) > GAP_EPS_SEC * 10) {
    throw new Error(`inserts end at ${cursor}s, plan lasts ${plan.durationSec}s`);
  }
}

function roundInsert(insert: PlanInsert): PlanInsert {
  return insert.kind === 'play'
    ? {
        kind: 'play',
        gameStart: round3(insert.gameStart),
        gameEnd: round3(insert.gameEnd),
        canvasStart: round3(insert.canvasStart),
        canvasEnd: round3(insert.canvasEnd),
      }
    : {
        kind: 'freeze',
        gameAt: round3(insert.gameAt),
        canvasStart: round3(insert.canvasStart),
        canvasEnd: round3(insert.canvasEnd),
      };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
