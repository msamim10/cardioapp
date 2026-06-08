import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import type { ComponentProps, PropsWithChildren } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  Achievement,
  Challenge,
  MetricCardData,
  MoveCardData,
  ReadinessItem,
  RunMode,
  RunnerUser,
  UiAccent,
  UiIconKind,
  WeeklyActivity,
} from '@/lib/run-ui-data';
import { levelLabel, percent } from '@/lib/run-ui-data';

export const neon = {
  bg: '#030712',
  panel: '#090d1d',
  panel2: '#111629',
  border: 'rgba(255,255,255,0.16)',
  muted: '#a6adc8',
  dim: '#69708d',
  text: '#f8fafc',
  lime: '#b9ff00',
  pink: '#ff2bc2',
  cyan: '#12c8ff',
  orange: '#ff7a10',
  purple: '#8d35ff',
  blue: '#3194ff',
};

const accentMap: Record<UiAccent, string> = {
  pink: neon.pink,
  lime: neon.lime,
  cyan: neon.cyan,
  orange: neon.orange,
  purple: neon.purple,
  blue: neon.blue,
};

const gradientMap: Record<UiAccent, readonly [string, string]> = {
  pink: ['#ff7a16', '#ff23bc'],
  lime: ['#b9ff00', '#61d500'],
  cyan: ['#16c8ff', '#1877ff'],
  orange: ['#ffdd18', '#ff5d12'],
  purple: ['#8d35ff', '#e52bff'],
  blue: ['#12c8ff', '#713cff'],
};

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const iconGlyphs: Record<UiIconKind, MaterialIconName> = {
  home: 'home',
  play: 'gamepad-variant',
  challenge: 'trophy',
  progress: 'chart-bar',
  profile: 'account',
  settings: 'cog',
  search: 'magnify',
  coin: 'currency-usd',
  plus: 'plus',
  fire: 'fire',
  bolt: 'lightning-bolt',
  timer: 'timer-outline',
  trophy: 'crown',
  chart: 'chart-bar',
  runner: 'run-fast',
  shoe: 'shoe-sneaker',
  jump: 'arrow-up-bold',
  duck: 'arrow-down-bold',
  left: 'arrow-left-bold',
  right: 'arrow-right-bold',
  music: 'music',
  sound: 'volume-high',
  space: 'arrow-expand-horizontal',
  check: 'check',
  arrow: 'chevron-right',
  heart: 'heart',
  users: 'account-group',
  medical: 'medical-bag',
};

export function accentColor(accent: UiAccent): string {
  return accentMap[accent];
}

export function accentGradient(accent: UiAccent): readonly [string, string] {
  return gradientMap[accent];
}

export function NeonScreen({
  children,
  contentStyle,
}: PropsWithChildren<{ contentStyle?: StyleProp<ViewStyle> }>) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function AppHeader({
  user,
  action = 'settings',
  onActionPress,
}: {
  user: RunnerUser;
  action?: 'settings' | 'search' | 'back' | 'music';
  onActionPress?: () => void;
}) {
  const actionKind: UiIconKind =
    action === 'search' ? 'search' : action === 'music' ? 'music' : action === 'back' ? 'left' : 'settings';

  return (
    <View style={styles.header}>
      <View style={styles.headerIdentity}>
        <ExpoImage source={user.avatarImage} style={styles.avatar} contentFit="cover" contentPosition="top center" />
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerName} numberOfLines={1}>
            {user.name}
          </Text>
          <View style={styles.streakPill}>
            <MaterialCommunityIcons name="fire" size={16} color={neon.orange} />
            <Text style={styles.streakText}>{user.streakDays} DAY STREAK</Text>
          </View>
        </View>
      </View>
      <View style={styles.headerActions}>
        <CoinPill coins={user.coins} />
        <Pressable style={styles.circleButton} onPress={onActionPress}>
          <Ionicons
            name={
              action === 'search'
                ? 'search'
                : action === 'music'
                  ? 'musical-notes'
                  : action === 'back'
                    ? 'arrow-back'
                    : 'settings'
            }
            size={23}
            color={action === 'music' ? neon.purple : neon.text}
          />
        </Pressable>
      </View>
    </View>
  );
}

export function IconBadge({
  kind,
  accent,
  size = 36,
}: {
  kind: UiIconKind;
  accent: UiAccent;
  size?: number;
}) {
  const color = accentColor(accent);
  return (
    <View
      style={[
        styles.iconBadge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
          backgroundColor: `${color}22`,
        },
      ]}
    >
      <MaterialCommunityIcons name={iconGlyphs[kind]} size={Math.max(14, size * 0.54)} color={color} />
    </View>
  );
}

export function CoinPill({ coins }: { coins: number }) {
  return (
    <View style={styles.coinPill}>
      <View style={styles.coinIcon}>
        <MaterialCommunityIcons name="currency-usd" size={17} color={neon.orange} />
      </View>
      <Text style={styles.coinText}>{new Intl.NumberFormat('en-US').format(coins)}</Text>
      <View style={styles.plusDot}>
        <Text style={styles.plusDotText}>+</Text>
      </View>
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
}: {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <IconBadge kind="trophy" accent="pink" size={26} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {actionLabel ? (
        <Pressable onPress={onActionPress} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel} &gt;</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function GradientButton({
  label,
  accent = 'pink',
  icon = 'runner',
  onPress,
  compact = false,
}: {
  label: string;
  accent?: UiAccent;
  icon?: UiIconKind;
  onPress?: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <LinearGradient colors={accentGradient(accent)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.cta, compact && styles.ctaCompact]}>
        <IconBadge kind={icon} accent="blue" size={compact ? 30 : 42} />
        <Text style={[styles.ctaText, compact && styles.ctaTextCompact]} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
        <Text style={[styles.ctaArrow, compact && styles.ctaArrowCompact]}>&gt;&gt;</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function HeroImageCard({
  image,
  onPress,
  minHeight = 280,
  children,
}: PropsWithChildren<{ image: ImageSourcePropType; onPress?: () => void; minHeight?: number }>) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.heroCard, { minHeight }, pressed && styles.pressed]}>
      <ImageBackground source={image} resizeMode="cover" style={styles.imageFill}>
        <LinearGradient colors={['rgba(3,7,18,0.08)', 'rgba(3,7,18,0.82)']} style={styles.heroOverlay}>
          {children}
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

export function CroppedArtworkCard({
  image,
  onPress,
  minHeight = 280,
  cropBottom = false,
  imagePosition = 'center',
  children,
}: PropsWithChildren<{
  image: ImageSourcePropType;
  onPress?: () => void;
  minHeight?: number;
  cropBottom?: boolean;
  imagePosition?: 'center' | 'left center' | 'top center';
}>) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.heroCard, { minHeight }, pressed && styles.pressed]}>
      <View style={styles.imageFill}>
        <ExpoImage
          source={image}
          contentFit="cover"
          contentPosition={imagePosition}
          style={[styles.croppedArtworkImage, cropBottom && styles.croppedArtworkImageTall]}
        />
        <LinearGradient colors={['rgba(3,7,18,0.08)', 'rgba(3,7,18,0.74)']} style={styles.croppedArtworkOverlay} />
        <View style={styles.croppedArtworkContent}>{children}</View>
      </View>
    </Pressable>
  );
}

export function InfoPill({
  icon,
  accent,
  label,
  compact = false,
}: {
  icon: UiIconKind;
  accent: UiAccent;
  label: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.infoPill, compact && styles.infoPillCompact, { borderColor: `${accentColor(accent)}77` }]}>
      <IconBadge kind={icon} accent={accent} size={compact ? 20 : 22} />
      <Text style={[styles.infoPillText, compact && styles.infoPillTextCompact]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function ProgressBar({
  current,
  target,
  accent = 'lime',
  label,
}: {
  current: number;
  target: number;
  accent?: UiAccent;
  label?: string;
}) {
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${percent(current, target) * 100}%`, backgroundColor: accentColor(accent) },
          ]}
        />
      </View>
      {label ? <Text style={[styles.progressLabel, { color: accentColor(accent) }]}>{label}</Text> : null}
    </View>
  );
}

export function ModeTile({
  mode,
  onPress,
  wide = false,
  compact = false,
}: {
  mode: RunMode;
  onPress?: () => void;
  wide?: boolean;
  compact?: boolean;
}) {
  const showDynamicText = !mode.imageHasText;
  const tileStyle = compact ? styles.modeCompact : wide ? styles.modeWide : styles.modeTile;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [tileStyle, pressed && styles.pressed]}>
      <View style={styles.imageFill}>
        <ExpoImage
          source={mode.image}
          contentFit="cover"
          contentPosition={mode.imagePosition ?? 'center'}
          style={styles.modeImage}
        />
        {showDynamicText ? (
          <LinearGradient colors={['rgba(3,7,18,0.1)', 'rgba(3,7,18,0.9)']} style={styles.cardOverlay}>
            <View style={styles.modeContent}>
              <Text style={styles.modeTitle} numberOfLines={2}>
                {mode.title}
              </Text>
              <View style={styles.modeMetaRow}>
                <IconBadge kind={mode.icon} accent={mode.accent} size={24} />
                <Text style={[styles.modeMetaText, { color: accentColor(mode.accent) }]}>
                  {mode.durationMin > 0 ? `${mode.durationMin} min` : levelLabel(mode.level)}
                </Text>
              </View>
            </View>
          </LinearGradient>
        ) : null}
      </View>
    </Pressable>
  );
}

export function RecommendedRunRow({ mode, onPress }: { mode: RunMode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.runRow, pressed && styles.pressed]}>
      <View style={styles.runRowImageWrap}>
        <Image
          source={mode.image}
          style={[styles.runRowImage, mode.imageHasText && styles.runRowImageTextCrop]}
          resizeMode="cover"
        />
      </View>
      <View style={styles.runRowBody}>
        <Text style={styles.runRowTitle} numberOfLines={1}>
          {mode.title}
        </Text>
        <View style={styles.runRowMeta}>
          <Text style={styles.runRowMetaText}>{mode.durationMin} min</Text>
          <Text style={styles.runRowMetaText}>{mode.calorieRange}</Text>
          <Text style={styles.runRowMetaText}>{levelLabel(mode.level)}</Text>
        </View>
      </View>
      <View style={[styles.arrowCircle, { backgroundColor: accentColor(mode.accent) }]}>
        <Text style={styles.arrowCircleText}>&gt;</Text>
      </View>
    </Pressable>
  );
}

export function ChallengeFeatureCard({ challenge, onPress }: { challenge: Challenge; onPress?: () => void }) {
  if (challenge.imageHasText) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.challengeFeature, styles.challengeFeatureTemplate, pressed && styles.pressed]}
      >
        <ImageBackground source={challenge.image} resizeMode="cover" style={styles.imageFill}>
          <View style={styles.templateRewardPatch}>
            <Text style={styles.templateRewardText} numberOfLines={1} adjustsFontSizeToFit>
              +{challenge.rewardCoins} coins
            </Text>
          </View>
          <View style={styles.templateProgressWrap}>
            <View
              style={[
                styles.templateProgressFill,
                { width: `${percent(challenge.progress, challenge.target) * 100}%` },
              ]}
            />
            <Text style={styles.templateProgressText}>
              {challenge.progress} / {challenge.target}
            </Text>
          </View>
        </ImageBackground>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.challengeFeature, styles.challengeFeatureDynamic, pressed && styles.pressed]}>
      <ImageBackground source={challenge.image} resizeMode="cover" style={styles.imageFill}>
        <LinearGradient colors={['rgba(3,7,18,0.32)', 'rgba(82,16,139,0.94)']} style={styles.challengeFeatureOverlay}>
          <View style={styles.challengeFeatureText}>
            <Text style={styles.kicker}>TODAY'S CHALLENGE</Text>
            <Text style={styles.challengeFeatureTitle} numberOfLines={2}>
              {challenge.title}
            </Text>
            <Text style={styles.challengeSub}>{challenge.subtitle}</Text>
            <Text style={styles.rewardText}>Reward: +{challenge.rewardCoins} coins</Text>
            <ProgressBar
              current={challenge.progress}
              target={challenge.target}
              accent="lime"
              label={`${challenge.progress} / ${challenge.target}`}
            />
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

function ChallengeIconGlyph({ kind, color, size = 34 }: { kind: UiIconKind; color: string; size?: number }) {
  const iconName: MaterialIconName =
    kind === 'jump'
      ? 'run-fast'
      : kind === 'fire'
        ? 'fire'
        : kind === 'play'
          ? 'flag-checkered'
          : kind === 'users'
            ? 'account-group'
            : kind === 'duck'
              ? 'arrow-down-bold'
              : 'trophy';

  return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
}

export function ChallengeRow({ challenge, onPress }: { challenge: Challenge; onPress?: () => void }) {
  const color = accentColor(challenge.accent);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.challengeRow, pressed && styles.pressed]}>
      <ExpoImage
        source={challenge.image}
        contentFit="cover"
        contentPosition="left center"
        style={styles.challengeRowArtwork}
      />
      <LinearGradient
        colors={['rgba(17,22,41,0)', 'rgba(17,22,41,0.8)', 'rgba(17,22,41,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.challengeRowArtworkFade}
      />
      <View style={[styles.challengeIconFrame, { borderColor: `${color}cc`, backgroundColor: `${color}18` }]}>
        <ChallengeIconGlyph kind={challenge.icon} color={color} />
      </View>
      <View style={styles.challengeRowBody}>
        <Text style={styles.challengeRowTitle}>{challenge.title}</Text>
        <Text style={styles.challengeRowSub}>{challenge.subtitle}</Text>
        <View style={styles.challengeProgressLine}>
          <Text style={[styles.challengeProgressCount, { color }]}>
            {challenge.progress} / {challenge.target}
          </Text>
          <View style={styles.challengeMiniTrack}>
            <View
              style={[
                styles.challengeMiniFill,
                { width: `${percent(challenge.progress, challenge.target) * 100}%`, backgroundColor: color },
              ]}
            />
          </View>
        </View>
      </View>
      <View style={styles.rewardBlock}>
        <Text style={styles.rewardLabel}>REWARD</Text>
        <View style={styles.rewardAmountRow}>
          <MaterialCommunityIcons name="currency-usd" size={18} color="#ffd800" />
          <Text style={[styles.rewardAmount, { color }]}>+{challenge.rewardCoins}</Text>
        </View>
      </View>
      <View style={[styles.arrowCircleSmall, { backgroundColor: color }]}>
        <Text style={styles.arrowCircleText}>&gt;</Text>
      </View>
    </Pressable>
  );
}

export function MetricCard({ metric, compact = false }: { metric: MetricCardData; compact?: boolean }) {
  return (
    <View style={[styles.metricCard, compact && styles.metricCardCompact, { borderColor: `${accentColor(metric.accent)}66` }]}>
      <IconBadge kind={metric.icon} accent={metric.accent} size={compact ? 34 : 46} />
      <Text style={[styles.metricValue, compact && styles.metricValueCompact]} numberOfLines={1} adjustsFontSizeToFit>
        {metric.value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={2}>
        {metric.label}
      </Text>
      {metric.detail ? <Text style={[styles.metricDetail, { color: accentColor(metric.accent) }]}>{metric.detail}</Text> : null}
      {metric.trend ? <MiniTrend values={metric.trend} color={accentColor(metric.accent)} /> : null}
    </View>
  );
}

function MiniTrend({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.trendRow}>
      {values.map((value, index) => (
        <View
          key={`${value}-${index}`}
          style={[
            styles.trendBar,
            { height: 5 + (value / max) * 18, backgroundColor: color },
          ]}
        />
      ))}
    </View>
  );
}

export function MoveCard({ move, compact = false }: { move: MoveCardData; compact?: boolean }) {
  const imageStyle = [
    styles.moveImageAsset,
    move.imageHasText && move.imageCrop === 'left' && styles.moveImageLeftCrop,
    move.imageHasText && move.imageCrop === 'top' && styles.moveImageTopCrop,
    compact && styles.moveImageAssetCompact,
  ];

  return (
    <View style={[styles.moveCard, compact && styles.moveCardCompact, { borderColor: `${accentColor(move.accent)}88` }]}>
      {move.image ? (
        <View style={[styles.moveImage, compact && styles.moveImageCompact]}>
          <Image source={move.image} resizeMode="cover" style={imageStyle} />
          <LinearGradient colors={['rgba(3,7,18,0.02)', 'rgba(3,7,18,0.7)']} style={styles.moveImageOverlay} />
        </View>
      ) : null}
      <View style={[styles.moveBody, compact && styles.moveBodyCompact]}>
        <IconBadge kind={move.icon} accent={move.accent} size={compact ? 34 : 38} />
        <Text style={[styles.moveTitle, compact && styles.moveTitleCompact, { color: accentColor(move.accent) }]}>
          {move.title}
        </Text>
        <Text style={[styles.moveSub, compact && styles.moveSubCompact]} numberOfLines={2}>
          {move.subtitle}
        </Text>
      </View>
    </View>
  );
}

export function ReadinessCard({ item, compact = false }: { item: ReadinessItem; compact?: boolean }) {
  return (
    <View style={[styles.readyCard, compact && styles.readyCardCompact, { borderColor: `${accentColor(item.accent)}88` }]}>
      <IconBadge kind={item.icon} accent={item.accent} size={compact ? 42 : 48} />
      <View style={styles.readyText}>
        <Text style={[styles.readyTitle, compact && styles.readyTitleCompact]} numberOfLines={compact ? 2 : undefined}>
          {item.title}
        </Text>
        <Text style={[styles.readySub, compact && styles.readySubCompact]} numberOfLines={compact ? 3 : undefined}>
          {item.subtitle}
        </Text>
      </View>
      <IconBadge kind={item.ready ? 'check' : 'plus'} accent={item.ready ? 'lime' : 'orange'} size={compact ? 26 : 30} />
    </View>
  );
}

export function AchievementCard({ item }: { item: Achievement }) {
  return (
    <View style={[styles.achievementCard, { borderColor: `${accentColor(item.accent)}66` }]}>
      <IconBadge kind={item.icon} accent={item.accent} size={54} />
      <Text style={[styles.achievementTitle, { color: accentColor(item.accent) }]} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.achievementSub} numberOfLines={2}>
        {item.subtitle}
      </Text>
      {typeof item.progress === 'number' && typeof item.target === 'number' ? (
        <ProgressBar current={item.progress} target={item.target} accent={item.accent} label={`${item.progress} / ${item.target}`} />
      ) : null}
      {item.completed ? <IconBadge kind="check" accent="lime" size={26} /> : null}
    </View>
  );
}

export function WeeklyChart({ activity }: { activity: WeeklyActivity[] }) {
  const max = Math.max(...activity.map((item) => item.calories ?? 0), 1);
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartBars}>
        {activity.map((item) => {
          const height = item.calories === null ? 18 : 34 + (item.calories / max) * 94;
          return (
            <View key={item.day} style={styles.chartColumn}>
              <View style={[styles.chartBar, { height, opacity: item.calories === null ? 0.35 : 1 }]} />
              <Text style={styles.chartValue}>{item.calories ?? '--'}</Text>
              <Text style={styles.chartLabel}>{item.day}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function StatStrip({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.statStrip, style]}>{children}</View>;
}

export function Panel({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function routeOrDefault(route: string | undefined, fallback: string): string {
  return route ?? fallback;
}

export function useRoutePress(route?: string, fallback = '/start-run') {
  const router = useRouter();
  return () => router.push(routeOrDefault(route, fallback) as never);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: neon.bg,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 152,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 9,
  },
  headerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: neon.purple,
  },
  headerTextWrap: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  headerName: {
    color: neon.text,
    fontSize: 18,
    fontWeight: '900',
  },
  streakPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 24,
    paddingLeft: 7,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,122,16,0.55)',
    backgroundColor: 'rgba(255,122,16,0.08)',
  },
  streakText: {
    color: neon.text,
    fontSize: 11,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  coinIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: neon.orange,
    backgroundColor: 'rgba(255,122,16,0.12)',
  },
  coinText: {
    color: neon.text,
    fontSize: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  plusDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: neon.purple,
  },
  plusDotText: {
    color: neon.text,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '900',
  },
  iconBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  sectionTitle: {
    color: neon.text,
    fontSize: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionAction: {
    color: neon.pink,
    fontSize: 13,
    fontWeight: '800',
  },
  heroCard: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,43,194,0.9)',
    backgroundColor: neon.panel,
  },
  imageFill: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  croppedArtworkImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  croppedArtworkImageTall: {
    height: '132%',
  },
  croppedArtworkOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  croppedArtworkContent: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 16,
  },
  heroOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
  },
  cta: {
    minHeight: 82,
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.36)',
    boxShadow: '0 10px 24px rgba(255,35,188,0.35)',
  },
  ctaCompact: {
    minHeight: 56,
    paddingHorizontal: 18,
    gap: 10,
  },
  ctaText: {
    flexShrink: 1,
    color: neon.text,
    fontSize: 32,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  ctaTextCompact: {
    fontSize: 20,
  },
  ctaArrow: {
    color: neon.text,
    fontSize: 28,
    fontWeight: '900',
  },
  ctaArrowCompact: {
    fontSize: 20,
  },
  infoPill: {
    minHeight: 52,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(9,13,29,0.84)',
    borderWidth: 1,
  },
  infoPillCompact: {
    minHeight: 40,
    gap: 6,
    paddingHorizontal: 9,
    borderRadius: 14,
  },
  infoPillText: {
    color: neon.text,
    fontSize: 14,
    fontWeight: '900',
  },
  infoPillTextCompact: {
    fontSize: 12,
  },
  progressWrap: {
    gap: 5,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  modeTile: {
    width: 128,
    height: 156,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: neon.border,
    backgroundColor: neon.panel2,
  },
  modeCompact: {
    width: 86,
    height: 108,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: neon.border,
    backgroundColor: neon.panel2,
  },
  modeImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  modeWide: {
    width: 182,
    height: 178,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: neon.border,
    backgroundColor: neon.panel2,
  },
  modeContent: {
    padding: 12,
    gap: 8,
  },
  modeTitle: {
    color: neon.text,
    fontSize: 17,
    fontWeight: '900',
  },
  modeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeMetaText: {
    fontSize: 12,
    fontWeight: '900',
  },
  runRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(17,22,41,0.82)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  runRowImageWrap: {
    width: 94,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: neon.panel,
  },
  runRowImage: {
    width: '100%',
    height: '100%',
  },
  runRowImageTextCrop: {
    width: 150,
    height: 64,
  },
  runRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  runRowTitle: {
    color: neon.text,
    fontSize: 18,
    fontWeight: '900',
  },
  runRowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  runRowMetaText: {
    color: neon.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  arrowCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowCircleSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowCircleText: {
    color: neon.bg,
    fontSize: 24,
    fontWeight: '900',
  },
  challengeFeature: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,43,194,0.75)',
    backgroundColor: neon.panel,
  },
  challengeFeatureDynamic: {
    minHeight: 164,
  },
  challengeFeatureTemplate: {
    aspectRatio: 3,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  challengeFeatureOverlay: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  challengeFeatureText: {
    width: '66%',
    gap: 6,
  },
  kicker: {
    color: neon.lime,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  challengeFeatureTitle: {
    color: neon.text,
    fontSize: 27,
    fontWeight: '900',
  },
  challengeSub: {
    color: neon.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  rewardText: {
    color: '#ffd800',
    fontSize: 14,
    fontWeight: '900',
  },
  templateRewardPatch: {
    position: 'absolute',
    left: '55.5%',
    top: '52%',
    width: '17%',
    height: '14%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(91,19,154,0.72)',
  },
  templateRewardText: {
    color: '#ffd800',
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  templateProgressWrap: {
    position: 'absolute',
    left: '39%',
    right: '19%',
    bottom: '17%',
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
  },
  templateProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: neon.lime,
  },
  templateProgressText: {
    position: 'absolute',
    left: 8,
    top: 0,
    color: neon.bg,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  challengeRow: {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(17,22,41,0.86)',
    borderWidth: 1,
    borderColor: neon.border,
    overflow: 'hidden',
  },
  challengeRowArtwork: {
    position: 'absolute',
    top: 0,
    right: 42,
    bottom: 0,
    width: 140,
    opacity: 0.78,
  },
  challengeRowArtworkFade: {
    position: 'absolute',
    top: 0,
    right: 38,
    bottom: 0,
    width: 176,
  },
  challengeIconFrame: {
    width: 62,
    height: 62,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 16px rgba(255,43,194,0.16)',
  },
  challengeRowBody: {
    flex: 1,
    gap: 4,
    minWidth: 0,
    zIndex: 1,
  },
  challengeRowTitle: {
    color: neon.text,
    fontSize: 18,
    fontWeight: '900',
  },
  challengeRowSub: {
    color: neon.muted,
    fontSize: 12,
  },
  challengeProgressLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  challengeProgressCount: {
    width: 44,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  challengeMiniTrack: {
    flex: 1,
    height: 9,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  challengeMiniFill: {
    height: '100%',
    borderRadius: 999,
  },
  rewardBlock: {
    alignItems: 'flex-end',
    width: 72,
    zIndex: 1,
  },
  rewardLabel: {
    color: neon.pink,
    fontSize: 10,
    fontWeight: '900',
  },
  rewardAmount: {
    fontSize: 18,
    fontWeight: '900',
  },
  rewardAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metricCard: {
    flex: 1,
    minHeight: 130,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(17,22,41,0.85)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  metricCardCompact: {
    minHeight: 116,
    padding: 10,
  },
  metricValue: {
    color: neon.text,
    fontSize: 31,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricValueCompact: {
    fontSize: 24,
  },
  metricLabel: {
    color: neon.muted,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  metricDetail: {
    fontSize: 12,
    fontWeight: '900',
  },
  trendRow: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginTop: 3,
  },
  trendBar: {
    width: 7,
    borderRadius: 4,
  },
  moveCard: {
    width: 150,
    minHeight: 190,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: neon.panel2,
  },
  moveCardCompact: {
    width: 112,
    minHeight: 170,
    borderRadius: 16,
  },
  moveImage: {
    height: 92,
    overflow: 'hidden',
    backgroundColor: neon.panel,
  },
  moveImageCompact: {
    height: 74,
  },
  moveImageAsset: {
    width: '100%',
    height: '100%',
  },
  moveImageAssetCompact: {
    height: 118,
  },
  moveImageLeftCrop: {
    width: 250,
    height: 92,
  },
  moveImageTopCrop: {
    height: 156,
    top: 0,
  },
  moveImageOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  moveBody: {
    padding: 12,
    gap: 6,
    alignItems: 'center',
  },
  moveBodyCompact: {
    padding: 9,
    gap: 5,
  },
  moveTitle: {
    fontSize: 20,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  moveTitleCompact: {
    fontSize: 17,
  },
  moveSub: {
    color: neon.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  moveSubCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  readyCard: {
    flex: 1,
    minHeight: 116,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: 'rgba(17,22,41,0.82)',
    gap: 8,
  },
  readyCardCompact: {
    minHeight: 150,
    padding: 10,
    borderRadius: 15,
    gap: 7,
  },
  readyText: {
    flex: 1,
  },
  readyTitle: {
    color: neon.text,
    fontSize: 16,
    fontWeight: '900',
  },
  readyTitleCompact: {
    fontSize: 14,
    lineHeight: 17,
  },
  readySub: {
    color: neon.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  readySubCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  achievementCard: {
    flex: 1,
    minWidth: 126,
    minHeight: 156,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(17,22,41,0.82)',
    borderWidth: 1,
    alignItems: 'center',
    gap: 7,
  },
  achievementTitle: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  achievementSub: {
    color: neon.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  chartCard: {
    minHeight: 190,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(17,22,41,0.72)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  chartBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  chartBar: {
    width: 26,
    borderRadius: 8,
    backgroundColor: neon.pink,
  },
  chartValue: {
    color: neon.text,
    fontSize: 11,
    fontWeight: '800',
  },
  chartLabel: {
    color: neon.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  statStrip: {
    flexDirection: 'row',
    gap: 12,
  },
  panel: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(17,22,41,0.82)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
});
