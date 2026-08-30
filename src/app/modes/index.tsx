import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModeCampaignPath } from '@/components/ModeCampaignPath';
import { useProgress } from '@/lib/ProgressContext';
import { isClassKey, parseClassKeyParam } from '@/lib/progression';
import { colors, font, radius, spacing } from '@/theme';

export default function ModeMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { classKey } = useLocalSearchParams<{ classKey?: string | string[] }>();
  const { activeClass, setActiveClass, classData } = useProgress();
  const routeClassKey = Array.isArray(classKey) ? classKey[0] : classKey;
  const requestedClass = isClassKey(routeClassKey) ? routeClassKey : null;
  const selectedClass = parseClassKeyParam(classKey, activeClass);
  const selectedData = classData(selectedClass);
  const progress =
    selectedData.total > 0 ? selectedData.completedCount / selectedData.total : 0;

  useEffect(() => {
    if (requestedClass && requestedClass !== activeClass) {
      setActiveClass(requestedClass);
    }
  }, [activeClass, requestedClass, setActiveClass]);

  return (
    <View style={styles.root}>
      <View style={[styles.headerRow, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to Levels"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.progressLabel}>CAMPAIGN PATH</Text>
          <Text style={styles.progressTitle}>{selectedData.meta.label}</Text>
          <Text style={styles.progressCount}>
            {selectedData.completedCount} / {selectedData.total} levels
          </Text>
        </View>

        {selectedData.allComplete ? (
          <View
            style={styles.completeBadge}
            accessible
            accessibilityLabel={`${selectedData.meta.label} campaign complete`}
          >
            <Ionicons name="ribbon" size={14} color={colors.black} />
            <Text style={styles.completeBadgeText}>MODE COMPLETE</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressBlock}>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: selectedData.total,
              now: selectedData.completedCount,
            }}
          >
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.pathHint}>
            Follow the path. Complete each level to unlock the next at{' '}
            {selectedData.meta.speedFactor.toFixed(1)}x speed.
          </Text>
        </View>

        <ModeCampaignPath
          maps={selectedData.maps}
          onSelect={(entry) =>
            router.push({
              pathname: '/level/[id]',
              params: { id: entry.levelId, classKey: selectedClass },
            })
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: 36,
    height: 36,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, minWidth: 0 },
  progressLabel: {
    color: colors.textDim,
    fontSize: 9,
    fontWeight: font.black,
    letterSpacing: 1.1,
  },
  progressTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: font.black,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  progressCount: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.medium,
    marginTop: 2,
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    alignSelf: 'center',
  },
  completeBadgeText: { color: colors.black, fontSize: 9, fontWeight: font.black, letterSpacing: 0.5 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingTop: spacing.sm },
  progressBlock: { gap: spacing.sm },
  progressTrack: {
    height: 5,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.lime },
  pathHint: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: font.medium,
    lineHeight: 17,
  },
  pressed: { opacity: 0.72 },
});
