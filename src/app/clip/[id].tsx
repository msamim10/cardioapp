import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alertPhotosOutcome, saveVideoToPhotos, shareVideoFile } from '@/components/RunVideoCard';
import { deleteClip, getClip, toFileUri, type Clip } from '@/lib/clipsLibrary';
import { getMode } from '@/lib/gameData';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const MISS_RED = '#FF3B30';

/**
 * Full-screen player for one clip from the library (Profile → Clips). Share,
 * Save to Photos (add-only, asked on demand) and Delete; the header carries the
 * run's level, score, accuracy and date.
 */
export default function ClipScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [clip] = useState<Clip | null>(() => (id ? getClip(id) : null));
  const [busy, setBusy] = useState<'photos' | 'share' | null>(null);
  const [saved, setSaved] = useState(false);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  if (!clip) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="film-outline" size={32} color={colors.textFaint} />
        <Text style={styles.missing}>This clip is no longer on your phone.</Text>
        <Pressable onPress={goBack} accessibilityRole="button" style={styles.missingBack}>
          <Text style={styles.missingBackText}>Back to clips</Text>
        </Pressable>
      </View>
    );
  }

  return <ClipPlayer clip={clip} busy={busy} saved={saved} setBusy={setBusy} setSaved={setSaved} onBack={goBack} />;
}

function ClipPlayer({
  clip,
  busy,
  saved,
  setBusy,
  setSaved,
  onBack,
}: {
  clip: Clip;
  busy: 'photos' | 'share' | null;
  saved: boolean;
  setBusy: (next: 'photos' | 'share' | null) => void;
  setSaved: (next: boolean) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const levelName = getMode(clip.levelId)?.name ?? 'CardioSurf';
  const dateLabel = useMemo(() => formatClipDate(clip.createdAt), [clip.createdAt]);
  const player = useVideoPlayer({ uri: toFileUri(clip.filePath) }, (p) => {
    p.loop = true;
    p.play();
  });

  const save = async () => {
    if (busy) return;
    setBusy('photos');
    try {
      const outcome = await saveVideoToPhotos(clip.filePath);
      if (outcome === 'saved') setSaved(true);
      else alertPhotosOutcome(outcome);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      if ((await shareVideoFile(clip.filePath)) === 'unavailable') {
        Alert.alert('Sharing unavailable', 'Save the clip to Photos and share it from there.');
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    Alert.alert('Delete this clip?', 'It is only stored on this phone; deleting cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          player.pause();
          deleteClip(clip.id);
          onBack();
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText} pointerEvents="none">
          <Text style={styles.headerTitle} numberOfLines={1}>
            {levelName}
          </Text>
          <Text style={styles.headerMeta} numberOfLines={1}>
            {clip.score.toLocaleString()} · {Math.round(clip.accuracy * 100)}% · {dateLabel}
          </Text>
        </View>
        <Pressable
          onPress={remove}
          accessibilityRole="button"
          accessibilityLabel="Delete clip"
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={20} color={MISS_RED} />
        </Pressable>
      </View>

      <View
        style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Saved to Photos' : 'Save to Photos'}
          disabled={busy !== null}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        >
          {busy === 'photos' ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Ionicons
              name={saved ? 'checkmark-circle' : 'download-outline'}
              size={16}
              color={saved ? colors.lime : colors.text}
            />
          )}
          <Text style={styles.btnText}>{saved ? 'Saved' : 'Save to Photos'}</Text>
        </Pressable>
        <Pressable
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share clip"
          disabled={busy !== null}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
        >
          {busy === 'share' ? (
            <ActivityIndicator color={colors.black} size="small" />
          ) : (
            <Ionicons name="share-outline" size={16} color={colors.black} />
          )}
          <Text style={[styles.btnText, { color: colors.black }]}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatClipDate(epochMs: number): string {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.bg },
  missing: { ...type.body, color: colors.textDim, textAlign: 'center', paddingHorizontal: spacing.xl },
  missingBack: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  missingBackText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: 'rgba(8,9,10,0.62)',
  },
  headerTitle: { ...type.h3, color: colors.text },
  headerMeta: { ...metric, ...type.bodySm, color: colors.textDim, fontSize: 12 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,9,10,0.62)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.72 },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(8,9,10,0.72)',
  },
  btnPrimary: { backgroundColor: colors.lime, borderColor: colors.lime },
  btnText: { color: colors.text, fontSize: 14, fontWeight: font.bold },
});
