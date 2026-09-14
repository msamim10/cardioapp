import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBeatmap } from '@/lib/beatmapRegistry';
import {
  BEATMAP_MOVES,
  serializeBeatmap,
  type Beatmap,
  type BeatmapCue,
  type BeatmapMove,
} from '@/lib/beatmaps';
import { modes } from '@/lib/gameData';
import { describeChartRebuild, rebuildChartsNow } from '@/lib/leaderboards';
import { getVideoSource, hasVideo } from '@/lib/videoSources';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Hidden dev-only beatmap authoring screen (route registered only when
 * __DEV__). Plays a level's vertical video with the native scrubber, drops a
 * cue at the current position per button press, lets you nudge/delete/undo,
 * previews cue hits, and exports the JSON for src/data/beatmaps/<levelId>.json.
 */

const MOVE_ICON: Record<BeatmapMove, keyof typeof Ionicons.glyphMap> = {
  jump: 'arrow-up',
  duck: 'arrow-down',
  left: 'arrow-back',
  right: 'arrow-forward',
};

const NUDGE_S = 0.05;
/** A cue counts as "hit" in preview while the position is within this of it. */
const PREVIEW_FLASH_S = 0.15;
const PREVIEW_TICK_S = 0.05;

const LEVELS = modes.filter((mode) => hasVideo(mode.id));

function fmt(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

export default function DevBeatmapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [levelId, setLevelId] = useState(LEVELS[0]?.id ?? '');
  const [cues, setCues] = useState<BeatmapCue[]>([]);
  const historyRef = useRef<BeatmapCue[][]>([]);
  const [historySize, setHistorySize] = useState(0);
  const [offsetMs, setOffsetMs] = useState('0');
  const [halfSpeed, setHalfSpeed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [flash, setFlash] = useState<BeatmapMove | null>(null);

  const source = useMemo(() => getVideoSource(levelId, 'vertical'), [levelId]);
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = PREVIEW_TICK_S;
  });

  // Swap the source when the level changes; prefill from a registered map.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    player.replaceAsync(source).then(() => {
      if (cancelled) return;
      try {
        player.playbackRate = halfSpeed ? 0.5 : 1;
        player.pause();
      } catch {
        // released
      }
    }).catch(() => {});
    const existing = getBeatmap(levelId);
    historyRef.current = [];
    setHistorySize(0);
    setCues(existing ? existing.cues.map((cue) => ({ ...cue })) : []);
    return () => {
      cancelled = true;
    };
    // playbackRate is applied by its own effect; only re-run on level change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, player, source]);

  useEffect(() => {
    try {
      player.playbackRate = halfSpeed ? 0.5 : 1;
    } catch {
      // released
    }
  }, [halfSpeed, player]);

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      setPosition(currentTime);
      try {
        if (player.duration > 0) setDuration(player.duration);
      } catch {
        // released
      }
    });
    return () => sub.remove();
  }, [player]);

  // Preview: flash the move of any cue the playhead is currently passing.
  useEffect(() => {
    if (!preview) {
      setFlash(null);
      return;
    }
    const hit = cues.find((cue) => Math.abs(cue.t - position) <= PREVIEW_FLASH_S);
    setFlash(hit?.move ?? null);
  }, [cues, position, preview]);

  const commit = useCallback((next: BeatmapCue[]) => {
    setCues((current) => {
      historyRef.current = [...historyRef.current.slice(-49), current];
      setHistorySize(historyRef.current.length);
      return next;
    });
  }, []);

  const currentTime = useCallback(() => {
    try {
      return player.currentTime;
    } catch {
      return position;
    }
  }, [player, position]);

  const addCue = (move: BeatmapMove) => {
    const offset = Number(offsetMs) || 0;
    const t = Math.max(0, currentTime() + offset / 1000);
    commit([...cues, { t, move }].sort((a, b) => a.t - b.t));
  };

  const nudge = (index: number, deltaS: number) => {
    const next = cues.map((cue, i) => (i === index ? { ...cue, t: Math.max(0, cue.t + deltaS) } : cue));
    commit(next.sort((a, b) => a.t - b.t));
  };

  const remove = (index: number) => commit(cues.filter((_, i) => i !== index));

  const undo = () => {
    const previous = historyRef.current.pop();
    setHistorySize(historyRef.current.length);
    if (previous) setCues(previous);
  };

  const seekTo = (t: number) => {
    try {
      player.currentTime = Math.max(0, t - 1);
    } catch {
      // released
    }
  };

  const togglePlay = () => {
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch {
      // released
    }
  };

  const buildBeatmap = (): Beatmap => ({
    version: 1,
    levelId,
    videoDurationSec: duration > 0 ? duration : Math.max(1, ...cues.map((cue) => cue.t)),
    orientation: 'vertical',
    cues,
  });

  const exportJson = async () => {
    const json = serializeBeatmap(buildBeatmap());
    console.log(`[beatmap] ${levelId} (${cues.length} cues)\n${json}`);
    try {
      await Share.share({ message: json, title: `${levelId}.json` });
    } catch {
      Alert.alert('Export', 'JSON was written to the console.');
    }
  };

  // Admin: rebuild every level's consensus chart from stored move samples now
  // (the scheduled job does the same every 30 min). Server-guarded.
  const [rebuilding, setRebuilding] = useState(false);
  const forceRebuild = () => {
    if (rebuilding) return;
    setRebuilding(true);
    rebuildChartsNow()
      .then((levels) => Alert.alert('Charts rebuilt', describeChartRebuild(levels)))
      .catch((error: unknown) => Alert.alert('Rebuild failed', (error as Error).message))
      .finally(() => setRebuilding(false));
  };

  const clearAll = () => {
    Alert.alert('Clear all cues?', 'Undo can restore them.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => commit([]) },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Beatmap authoring</Text>
        <Pressable hitSlop={10} onPress={exportJson} style={styles.iconButton}>
          <Ionicons name="share-outline" size={20} color={colors.lime} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.levelRow}>
        {LEVELS.map((mode) => (
          <Pressable
            key={mode.id}
            onPress={() => setLevelId(mode.id)}
            style={[styles.levelChip, mode.id === levelId && styles.levelChipActive]}
          >
            <Text style={[styles.levelChipText, mode.id === levelId && styles.levelChipTextActive]}>
              {mode.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.videoFrame}>
        {source ? (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls />
        ) : (
          <Text style={styles.empty}>No vertical source for {levelId}</Text>
        )}
        {preview && flash ? (
          <View style={styles.flash} pointerEvents="none">
            <Ionicons name={MOVE_ICON[flash]} size={44} color={colors.black} />
            <Text style={styles.flashText}>{flash.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.transport}>
        <Pressable onPress={togglePlay} style={styles.smallButton}>
          <Ionicons name="play" size={16} color={colors.text} />
          <Text style={styles.smallButtonText}>Play/Pause</Text>
        </Pressable>
        <Text style={styles.clock}>
          {fmt(position)} / {fmt(duration)}
        </Text>
        <Pressable onPress={() => setHalfSpeed((v) => !v)} style={[styles.smallButton, halfSpeed && styles.smallButtonActive]}>
          <Text style={styles.smallButtonText}>{halfSpeed ? '0.5×' : '1×'}</Text>
        </Pressable>
        <Pressable onPress={() => setPreview((v) => !v)} style={[styles.smallButton, preview && styles.smallButtonActive]}>
          <Ionicons name="eye-outline" size={16} color={colors.text} />
          <Text style={styles.smallButtonText}>Preview</Text>
        </Pressable>
      </View>

      <View style={styles.moveRow}>
        {BEATMAP_MOVES.map((move) => (
          <Pressable key={move} onPress={() => addCue(move)} style={styles.moveButton}>
            <Ionicons name={MOVE_ICON[move]} size={26} color={colors.black} />
            <Text style={styles.moveButtonText}>{move.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.toolsRow}>
        <View style={styles.offsetBox}>
          <Text style={styles.offsetLabel}>Author offset (ms)</Text>
          <TextInput
            keyboardType="numbers-and-punctuation"
            onChangeText={setOffsetMs}
            style={styles.offsetInput}
            value={offsetMs}
          />
        </View>
        <Pressable onPress={undo} disabled={historySize === 0} style={[styles.smallButton, historySize === 0 && styles.disabled]}>
          <Ionicons name="arrow-undo" size={16} color={colors.text} />
          <Text style={styles.smallButtonText}>Undo</Text>
        </Pressable>
        <Pressable onPress={clearAll} disabled={cues.length === 0} style={[styles.smallButton, cues.length === 0 && styles.disabled]}>
          <Ionicons name="trash-outline" size={16} color={colors.pink} />
        </Pressable>
      </View>

      <View style={styles.toolsRow}>
        <Pressable onPress={forceRebuild} disabled={rebuilding} style={[styles.smallButton, rebuilding && styles.disabled]}>
          <Ionicons name="cloud-upload-outline" size={16} color={colors.lime} />
          <Text style={styles.smallButtonText}>{rebuilding ? 'Rebuilding…' : 'Force rebuild charts'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
        <Text style={styles.listHeader}>
          {cues.length} cue{cues.length === 1 ? '' : 's'} · {levelId}
        </Text>
        {cues.map((cue, index) => {
          const near = Math.abs(cue.t - position) <= PREVIEW_FLASH_S;
          return (
            <View key={`${index}-${cue.t}-${cue.move}`} style={[styles.cueRow, near && styles.cueRowNear]}>
              <Pressable onPress={() => seekTo(cue.t)} style={styles.cueLead}>
                <Ionicons name={MOVE_ICON[cue.move]} size={16} color={colors.lime} />
                <Text style={styles.cueTime}>{fmt(cue.t)}</Text>
                <Text style={styles.cueMove}>{cue.move}</Text>
              </Pressable>
              <Pressable hitSlop={6} onPress={() => nudge(index, -NUDGE_S)} style={styles.nudge}>
                <Text style={styles.nudgeText}>−50</Text>
              </Pressable>
              <Pressable hitSlop={6} onPress={() => nudge(index, NUDGE_S)} style={styles.nudge}>
                <Text style={styles.nudgeText}>+50</Text>
              </Pressable>
              <Pressable hitSlop={6} onPress={() => remove(index)} style={styles.nudge}>
                <Ionicons name="close" size={16} color={colors.pink} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: font.black, letterSpacing: -0.3 },
  levelRow: { paddingHorizontal: spacing.lg, gap: spacing.xs, paddingBottom: spacing.sm },
  levelChip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  levelChipActive: { backgroundColor: colors.lime },
  levelChipText: { color: colors.textDim, fontSize: 12, fontWeight: font.bold },
  levelChipTextActive: { color: colors.black },
  videoFrame: {
    height: 260,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { color: colors.textDim, fontSize: 13 },
  flash: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.lime,
  },
  flashText: { color: colors.black, fontSize: 14, fontWeight: font.black, letterSpacing: 1 },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  clock: { flex: 1, color: colors.text, fontSize: 13, fontWeight: font.bold, fontVariant: ['tabular-nums'], textAlign: 'center' },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  smallButtonActive: { backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.lime },
  smallButtonText: { color: colors.text, fontSize: 12, fontWeight: font.bold },
  disabled: { opacity: 0.4 },
  moveRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg },
  moveButton: {
    flex: 1,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.md,
    backgroundColor: colors.lime,
  },
  moveButtonText: { color: colors.black, fontSize: 11, fontWeight: font.black, letterSpacing: 0.6 },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  offsetBox: { flex: 1, gap: 2 },
  offsetLabel: { color: colors.textFaint, fontSize: 10, fontWeight: font.bold },
  offsetInput: {
    height: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 13,
    fontWeight: font.bold,
  },
  list: { flex: 1, paddingHorizontal: spacing.lg },
  listHeader: { color: colors.textFaint, fontSize: 11, fontWeight: font.bold, marginBottom: spacing.xs },
  cueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cueRowNear: { backgroundColor: 'rgba(215,255,62,0.10)' },
  cueLead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cueTime: { color: colors.text, fontSize: 13, fontWeight: font.bold, fontVariant: ['tabular-nums'] },
  cueMove: { color: colors.textDim, fontSize: 12, fontWeight: font.medium },
  nudge: {
    minWidth: 40,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  nudgeText: { color: colors.text, fontSize: 11, fontWeight: font.bold },
});
