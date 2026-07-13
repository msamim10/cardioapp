import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { getVideoSource } from '@/lib/videoSources';
import { colors, font, radius, spacing } from '@/theme';

export default function WorkoutScreen() {
  const { level } = useLocalSearchParams<{ level: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useKeepAwake();

  const source = getVideoSource(level, 'vertical');

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);

  const finish = () => router.replace('/summary');

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.5;
    if (source) p.play();
  });

  useEffect(() => {
    if (!source) return;
    const endSub = player.addListener('playToEnd', finish);
    const timeSub = player.addListener('timeUpdate', (e) => {
      const d = player.duration;
      if (d > 0) setProgress(Math.min(1, e.currentTime / d));
    });
    const statusSub = player.addListener('statusChange', (e) => {
      if (e.status === 'error') setStatus('error');
      else if (e.status === 'readyToPlay') setStatus('ready');
    });
    return () => {
      endSub.remove();
      timeSub.remove();
      statusSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, source]);

  // No streamable source configured: let the flow continue to results.
  if (!source) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar hidden />
        <Text style={styles.fallbackEmoji}>🎬</Text>
        <Text style={styles.fallbackTitle}>Level not available yet</Text>
        <Text style={styles.fallbackSub}>This video isn't hosted yet. Continue to see your results.</Text>
        <GradientButton label="CONTINUE" icon="arrow-forward" onPress={finish} style={{ marginTop: spacing.xl, alignSelf: 'stretch' }} />
        <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />

      {/* Loading */}
      {status === 'loading' ? (
        <View style={styles.centerOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.lime} />
          <Text style={styles.loadingText}>Loading level…</Text>
        </View>
      ) : null}

      {/* Error / not uploaded yet */}
      {status === 'error' ? (
        <View style={styles.endOverlay}>
          <Text style={styles.endEmoji}>🚧</Text>
          <Text style={styles.endTitle}>Level not ready yet</Text>
          <Text style={styles.fallbackSub}>This video is still uploading. Try Downtown Run, or check back soon.</Text>
          <GradientButton label="BACK" icon="arrow-back" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: spacing.lg }} />
        </View>
      ) : null}

      {/* Single exit control */}
      <Pressable
        onPress={() => router.back()}
        style={[styles.exitBtn, { top: insets.top + spacing.sm }]}
        hitSlop={12}
      >
        <Ionicons name="close" size={22} color={colors.white} />
      </Pressable>

      {/* Slim progress bar */}
      {status === 'ready' ? (
        <View style={[styles.progressWrap, { bottom: insets.bottom + spacing.xl }]}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  fallbackEmoji: { fontSize: 60, marginBottom: spacing.md },
  fallbackTitle: { color: colors.text, fontSize: 22, fontWeight: font.black },
  fallbackSub: { color: colors.textDim, fontSize: 14, fontWeight: font.medium, textAlign: 'center', marginTop: spacing.sm },
  link: { color: colors.lime, fontSize: 15, fontWeight: font.bold },
  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.white, fontSize: 14, fontWeight: font.semibold, marginTop: spacing.md },
  exitBtn: {
    position: 'absolute',
    left: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  endEmoji: { fontSize: 64 },
  endTitle: { color: colors.white, fontSize: 26, fontWeight: font.black, marginTop: spacing.sm },
  progressWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.lime },
});
