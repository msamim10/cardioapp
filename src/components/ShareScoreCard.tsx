import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { challengeWebUrl } from '@/lib/challengeLinks';
import { getModeCover } from '@/lib/modeCovers';
import { colors, font, metric, radius, spacing, type } from '@/theme';

export type ShareScoreInput = {
  runId: string;
  levelId: string;
  levelName: string;
  username: string | null;
  rank: number | null;
  score: number;
  accuracy: number;
  maxCombo: number;
};

const CARD_WIDTH = 320;

/** The rasterized artwork: cover, score, rank, "Can you beat it?", wordmark, link. */
export function ShareScoreCard({ input }: { input: ShareScoreInput }) {
  const cover = getModeCover(input.levelId);
  const link = challengeWebUrl(input.levelId, input.runId);
  return (
    <View style={styles.card} collapsable={false}>
      {cover ? <Image source={cover} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      <LinearGradient
        colors={['rgba(8,9,10,0.18)', 'rgba(8,9,10,0.62)', 'rgba(8,9,10,0.97)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.cardTop}>
        <Text style={styles.wordmark}>CARDIOSURF</Text>
        {input.rank ? (
          <View style={styles.rankPill}>
            <Ionicons name="trophy" size={11} color={colors.black} />
            <Text style={styles.rankPillText}>#{input.rank}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.handle} numberOfLines={1}>
          {input.username ? `@${input.username}` : 'A CardioSurf runner'}
        </Text>
        <Text style={styles.levelName} numberOfLines={2}>
          {input.levelName}
        </Text>
        <Text style={styles.score}>{input.score.toLocaleString()}</Text>
        <View style={styles.statsRow}>
          <Text style={styles.stat}>{Math.round(input.accuracy * 100)}% accuracy</Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>{input.maxCombo}x combo</Text>
        </View>
        <Text style={styles.cta}>Can you beat it?</Text>
        <Text style={styles.link} numberOfLines={1}>
          {link.replace(/^https:\/\//, '')}
        </Text>
      </View>
    </View>
  );
}

/**
 * Preview + share sheet. Rasterizes the card with react-native-view-shot and
 * hands the PNG to the system share sheet via expo-sharing. When the native
 * module is missing (dev client built before this feature) it falls back to
 * sharing the text + link so the button always does something.
 */
export function ShareScoreSheet({
  visible,
  input,
  onClose,
}: {
  visible: boolean;
  input: ShareScoreInput | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!input) return null;
  const link = challengeWebUrl(input.levelId, input.runId);
  const message = `${input.username ? `@${input.username}` : 'I'} scored ${input.score.toLocaleString()} (${Math.round(
    input.accuracy * 100,
  )}%) on ${input.levelName} in CardioSurf. Can you beat it? ${link}`;

  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let uri: string | null = null;
      try {
        uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      } catch {
        uri = null; // native module unavailable → text fallback below
      }
      if (uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your score', UTI: 'public.png' });
      } else {
        await Share.share({ message, url: link });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not open the share sheet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <Text style={styles.sheetTitle}>Beat my score</Text>
          <View ref={cardRef} collapsable={false} style={styles.capture}>
            <ShareScoreCard input={input} />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            onPress={share}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Share score card"
            accessibilityState={{ busy }}
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.72 }]}
          >
            {busy ? <ActivityIndicator color={colors.black} /> : <Ionicons name="share-outline" size={18} color={colors.black} />}
            <Text style={styles.shareBtnText}>SHARE</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: 400,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { color: colors.white, fontSize: 13, fontWeight: font.heavy, letterSpacing: 2.2 },
  rankPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  rankPillText: { ...metric, color: colors.black, fontSize: 12, fontWeight: font.heavy },
  cardBody: { gap: 2 },
  handle: { color: colors.lime, fontSize: 13, fontWeight: font.bold },
  levelName: { ...type.h2, color: colors.white, fontSize: 20, lineHeight: 24 },
  score: { ...metric, ...type.display, color: colors.white, marginTop: spacing.xs },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stat: { ...metric, color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: font.semibold },
  statDot: { color: 'rgba(255,255,255,0.5)' },
  cta: { ...type.h3, color: colors.lime, marginTop: spacing.md },
  link: { color: 'rgba(255,255,255,0.62)', fontSize: 11, fontWeight: font.medium, marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: { ...type.h2, color: colors.text },
  capture: { borderRadius: radius.xl, overflow: 'hidden' },
  error: { ...type.bodySm, color: colors.effort, textAlign: 'center' },
  shareBtn: {
    alignSelf: 'stretch',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  shareBtnText: { ...type.action, color: colors.black },
  cancel: { paddingVertical: spacing.xs },
  cancelText: { color: colors.textDim, fontSize: 14, fontWeight: font.semibold },
});
