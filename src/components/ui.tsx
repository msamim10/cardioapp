import { LinearGradient } from 'expo-linear-gradient';
import { Image, type ImageStyle } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewProps,
  ViewStyle,
} from 'react-native';
import { CLASS_META, CLASS_ORDER, type ClassKey, type LeaderRow } from '@/lib/progression';
import { AccentKey, accentColor, accentGradient, colors, font, metric, radius, spacing, type } from '@/theme';

const MASCOT_FULL = require('../../assets/mascot/fox.png');
const MASCOT_AVATAR = require('../../assets/mascot/fox-avatar.png');
const MASCOT_FULL_RATIO = 751 / 900; // width / height of the transparent cutout

// 4-frame run cycle (aligned/registered transparent frames, shared 384x472 box).
const RUN_FRAMES = [
  require('../../assets/mascot/run-1.png'),
  require('../../assets/mascot/run-2.png'),
  require('../../assets/mascot/run-3.png'),
  require('../../assets/mascot/run-4.png'),
];
const RUN_RATIO = 384 / 472; // width / height of each run-cycle frame
const RUN_FRAME_MS = 120; // ~8 fps frame swap reads as a natural stride

/**
 * Shared fox mascot. `size` is the height for the full running pose and the side
 * length for the square avatar. The art is a transparent PNG with its own colors,
 * so it is never tinted — render it on dark/surface backgrounds, never on lime.
 */
export function Mascot({
  size = 120,
  variant = 'full',
  style,
}: {
  size?: number;
  variant?: 'full' | 'avatar';
  style?: StyleProp<ImageStyle>;
}) {
  const isAvatar = variant === 'avatar';
  const width = isAvatar ? size : Math.round(size * MASCOT_FULL_RATIO);
  return (
    <Image
      source={isAvatar ? MASCOT_AVATAR : MASCOT_FULL}
      style={[{ width, height: size }, style]}
      contentFit="contain"
      accessibilityLabel="Fox mascot"
    />
  );
}

const GROUND_GAP = 18;
const GROUND_DASHES = [40, 20, 56, 24, 44, 16];
const GROUND_UNIT = GROUND_DASHES.reduce((sum, w) => sum + w + GROUND_GAP, 0);

function GroundUnit() {
  return (
    <View style={styles.groundUnit}>
      {GROUND_DASHES.map((w, i) => (
        <View key={i} style={[styles.groundDash, { width: w }]} />
      ))}
    </View>
  );
}

/**
 * Animated running mascot for onboarding: cycles through the 4 run-cycle frames
 * so the fox's legs actually move, over a ground strip of dashes scrolling
 * right-to-left so it reads as running forward. The frames face right, so the
 * ground moves left for forward motion. A subtle vertical bob + pulsing shadow
 * add life without looking bouncy (the legs now carry the motion). Uses the RN
 * Animated API on the native driver; honors the reduce-motion setting (a single
 * static frame, no cycling or scrolling).
 */
export function MascotRunner({ size = 200, style }: { size?: number; style?: ViewStyle }) {
  const bob = useRef(new Animated.Value(0)).current;
  const scroll = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % RUN_FRAMES.length);
    }, RUN_FRAME_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 240,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 240,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    const scrollLoop = Animated.loop(
      Animated.timing(scroll, {
        toValue: 1,
        duration: 850,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    bobLoop.start();
    scrollLoop.start();
    return () => {
      bobLoop.stop();
      scrollLoop.stop();
    };
  }, [reduceMotion, bob, scroll]);

  const width = Math.round(size * RUN_RATIO);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const shadowScale = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  const shadowOpacity = bob.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.24] });
  const groundX = scroll.interpolate({ inputRange: [0, 1], outputRange: [0, -GROUND_UNIT] });

  return (
    <View style={[styles.runnerWrap, { height: size + 44 }, style]}>
      <Animated.View style={[styles.runnerMascot, { transform: [{ translateY }] }]}>
        <Image
          source={RUN_FRAMES[reduceMotion ? 0 : frame]}
          style={{ width, height: size }}
          contentFit="contain"
          accessibilityLabel="Running fox mascot"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.runnerShadow,
          { opacity: shadowOpacity, transform: [{ scaleX: shadowScale }] },
        ]}
      />
      <View style={styles.groundClip}>
        <Animated.View style={[styles.groundRow, { transform: [{ translateX: groundX }] }]}>
          <GroundUnit />
          <GroundUnit />
          <GroundUnit />
        </Animated.View>
      </View>
    </View>
  );
}

export function ScreenTitle({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.screenTitle}>{title}</Text>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
  ...viewProps
}: { children: ReactNode; style?: ViewStyle } & Pick<
  ViewProps,
  'accessible' | 'accessibilityLabel'
>) {
  return (
    <View {...viewProps} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function StatChip({
  icon,
  label,
  accent = 'lime',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent?: AccentKey;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={16} color={accentColor[accent]} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function GradientButton({
  label,
  icon,
  accent = 'lime',
  onPress,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: AccentKey;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      <LinearGradient
        colors={accentGradient[accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBtn}
      >
        {icon ? <Ionicons name={icon} size={20} color={colors.black} /> : null}
        <Text style={styles.gradientBtnText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({
  label,
  icon,
  onPress,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ghostBtn, style, pressed && styles.pressed]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}
      <Text style={styles.ghostBtnText}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, accent = 'lime' }: { value: number; accent?: AccentKey }) {
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: accentColor[accent] },
        ]}
      />
    </View>
  );
}

/**
 * Thin, muted progress track for the casting companion screen. Deliberately
 * neutral (no bold accent fill) so it reads as calm ambient info, not a loud bar.
 */
export function ProgressTrack({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.thinTrack}>
      <View style={[styles.thinFill, { width: `${pct}%` }]} />
    </View>
  );
}

/** Centered value + label readout for compact stat rows (elapsed, calories, etc.). */
export function StatReadout({
  value,
  label,
  icon,
  accent = 'lime',
}: {
  value: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: AccentKey;
}) {
  return (
    <View style={styles.statReadout}>
      {icon ? <Ionicons name={icon} size={15} color={accentColor[accent]} /> : null}
      <Text style={styles.statReadoutValue}>{value}</Text>
      <Text style={styles.statReadoutLabel}>{label}</Text>
    </View>
  );
}

/** Compact meta pill (icon + label) for durations, difficulty, world, etc. */
export function Pill({
  icon,
  label,
  accent = 'lime',
  tone = 'dark',
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  accent?: AccentKey;
  tone?: 'dark' | 'onColor';
}) {
  const onColor = tone === 'onColor';
  return (
    <View style={[styles.pill, onColor && styles.pillOnColor]}>
      {icon ? (
        <Ionicons name={icon} size={13} color={onColor ? colors.black : accentColor[accent]} />
      ) : null}
      <Text style={[styles.pillText, onColor && { color: colors.black }]}>{label}</Text>
    </View>
  );
}

/** Row of pips showing runs completed this week against a weekly goal. */
export function WeekTracker({
  count,
  goal,
  accent = 'lime',
}: {
  count: number;
  goal: number;
  accent?: AccentKey;
}) {
  const pips = Array.from({ length: Math.max(1, goal) });
  return (
    <View style={styles.weekRow}>
      {pips.map((_, i) => (
        <View
          key={i}
          style={[
            styles.weekPip,
            { backgroundColor: i < count ? accentColor[accent] : colors.surface2 },
          ]}
        />
      ))}
    </View>
  );
}

/** Icon + value + label tile used across summary, profile and home stats. */
export function StatTile({
  icon,
  value,
  label,
  accent = 'lime',
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  accent?: AccentKey;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.statTile, style]}>
      <Ionicons name={icon} size={22} color={accentColor[accent]} />
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

/**
 * Large single/multi-select option row: an optional icon lead, title + optional
 * description, and a check affordance. Big tap target for onboarding-style flows.
 * The selected state is understated — a single brand-lime border, subtle fill,
 * and a filled check — so the flow reads as minimal rather than decorated.
 *
 * The selected highlight is always `colors.lime`, regardless of the `accent`
 * prop, so every selection reads with one consistent green.
 */
export function OptionCard({
  title,
  desc,
  icon,
  selected = false,
  onPress,
}: {
  title: string;
  desc?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: AccentKey;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionCard,
        selected && { borderColor: colors.lime, backgroundColor: colors.surface2 },
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <View
          style={[
            styles.optionLead,
            { backgroundColor: selected ? colors.lime : colors.surface2 },
          ]}
        >
          <Ionicons name={icon} size={22} color={selected ? colors.black : colors.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        {desc ? <Text style={styles.optionDesc}>{desc}</Text> : null}
      </View>
      <View
        style={[
          styles.optionCheck,
          selected && { borderColor: colors.lime, backgroundColor: colors.lime },
        ]}
      >
        {selected ? <Ionicons name="checkmark" size={15} color={colors.black} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * Compact pill for picking from a small set (days/week, session length, etc.).
 * Like OptionCard, the selected highlight is always brand lime regardless of the
 * `accent` prop so selections stay visually consistent.
 */
export function SelectChip({
  label,
  sublabel,
  selected = false,
  onPress,
  style,
}: {
  label: string;
  sublabel?: string;
  accent?: AccentKey;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectChip,
        selected && { borderColor: colors.lime, backgroundColor: colors.surface2 },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.selectChipLabel, selected && { color: colors.lime }]}>{label}</Text>
      {sublabel ? <Text style={styles.selectChipSub}>{sublabel}</Text> : null}
    </Pressable>
  );
}

/**
 * Horizontal picker for the three difficulty classes. The selected class gets a
 * lime highlight; each option shows its icon, label and speed tagline.
 */
export function ClassSelector({
  active,
  onSelect,
}: {
  active: ClassKey;
  onSelect: (key: ClassKey) => void;
}) {
  return (
    <View style={styles.classRow}>
      {CLASS_ORDER.map((key) => {
        const meta = CLASS_META[key];
        const selected = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.classChip,
              selected && { borderColor: colors.lime, backgroundColor: colors.surface2 },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={meta.icon}
              size={20}
              color={selected ? colors.lime : colors.textFaint}
            />
            <Text style={[styles.classChipLabel, selected && { color: colors.text }]}>
              {meta.label}
            </Text>
            <Text style={styles.classChipSub}>{meta.tagline}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Speed badge, e.g. "1.2x speed", used on class + pre-run screens. */
export function SpeedPill({ speedFactor, tone = 'dark' }: { speedFactor: number; tone?: 'dark' | 'onColor' }) {
  return <Pill icon="speedometer" label={`${speedFactor.toFixed(1)}x speed`} tone={tone} />;
}

/** Compact simulated leaderboard: a windowed list with the real user highlighted. */
export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  return (
    <View style={styles.leaderboard}>
      {rows.map((row) => (
        <View
          key={`${row.rank}-${row.name}`}
          style={[styles.leaderRow, row.isUser && styles.leaderRowUser]}
        >
          <Text style={[styles.leaderRank, row.isUser && { color: colors.black }]}>#{row.rank}</Text>
          <Text
            style={[styles.leaderName, row.isUser && { color: colors.black }]}
            numberOfLines={1}
          >
            {row.isUser ? 'You' : row.name}
          </Text>
          <View style={styles.leaderCals}>
            <Ionicons
              name="flame"
              size={13}
              color={row.isUser ? colors.black : colors.orange}
            />
            <Text style={[styles.leaderCalText, row.isUser && { color: colors.black }]}>
              {row.calories.toLocaleString()}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Slim top bar with an optional back chevron and a lime progress track. */
export function OnboardingTopBar({
  progress,
  onBack,
  topInset = 0,
}: {
  progress: number;
  onBack?: () => void;
  topInset?: number;
}) {
  return (
    <View style={[styles.topBar, { paddingTop: topInset + spacing.sm }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.topBarBack}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.topBarBack} />
      )}
      <View style={{ flex: 1 }}>
        <ProgressBar value={progress} accent="lime" />
      </View>
    </View>
  );
}

/** Square check toggle. Lime-filled with a black check when on. */
export function Checkbox({
  checked,
  onToggle,
  size = 26,
}: {
  checked: boolean;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <View style={[styles.checkbox, { width: size, height: size }, checked && styles.checkboxOn]}>
        {checked ? <Ionicons name="checkmark" size={Math.round(size * 0.62)} color={colors.black} /> : null}
      </View>
    </Pressable>
  );
}

export type UsernameStatus = 'empty' | 'checking' | 'valid' | 'invalid';

/**
 * `@`-prefixed handle input with a live status affordance (spinner while
 * checking, green check when valid) and a dice button to roll a random handle.
 */
export function UsernameField({
  value,
  onChangeText,
  onRandomize,
  status,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onRandomize: () => void;
  status: UsernameStatus;
}) {
  const borderColor =
    status === 'valid' ? colors.lime : status === 'invalid' ? colors.pink : colors.borderStrong;
  return (
    <View style={styles.usernameRow}>
      <View style={[styles.usernameField, { borderColor }]}>
        <Text style={styles.usernameAt}>@</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="username"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          style={styles.usernameInput}
        />
        {status === 'checking' ? (
          <ActivityIndicator size="small" color={colors.textDim} />
        ) : status === 'valid' ? (
          <View style={styles.usernameCheck}>
            <Ionicons name="checkmark" size={14} color={colors.black} />
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onRandomize}
        hitSlop={6}
        accessibilityLabel="Generate a random username"
        style={({ pressed }) => [styles.diceBtn, pressed && styles.pressed]}
      >
        <Ionicons name="shuffle" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Small rounded badge, e.g. a "Recommended" flag on an option. */
export function Badge({ label, accent = 'lime' }: { label: string; accent?: AccentKey }) {
  return (
    <View style={[styles.badge, { backgroundColor: accentColor[accent] }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

// Two colors only. A six-color burst reads as a birthday party; a monochrome
// brand-lime one reads as a race finish.
const CONFETTI_COLORS = [colors.lime, colors.white];

/**
 * Lightweight hand-rolled shard burst — no native dependency. Each particle is
 * a thin brand-colored View animated on the native driver from the top of the
 * screen outward and down. Deliberately sparse, rectangular and quick so it
 * registers as a finish-line marker rather than a celebration overlay. Set
 * `trigger` true to fire. Honors reduce-motion.
 */
export function ConfettiBurst({
  trigger,
  count = 22,
  duration = 1500,
}: {
  trigger: boolean;
  count?: number;
  duration?: number;
}) {
  const { width, height } = Dimensions.get('window');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const particles = useMemo(
    () =>
      Array.from({ length: count }).map(() => ({
        progress: new Animated.Value(0),
        startX: Math.random() * width,
        driftX: (Math.random() * 2 - 1) * 90,
        fall: height * (0.5 + Math.random() * 0.45),
        size: 2 + Math.random() * 2,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        delay: Math.random() * 180,
        spin: (Math.random() * 2 - 1) * 90,
      })),
    [count, width, height]
  );

  useEffect(() => {
    if (!trigger || reduceMotion) return;
    const anims = particles.map((p) =>
      Animated.timing(p.progress, {
        toValue: 1,
        duration,
        delay: p.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    particles.forEach((p) => p.progress.setValue(0));
    Animated.parallel(anims).start();
  }, [trigger, reduceMotion, particles, duration]);

  if (!trigger || reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p, i) => {
        const translateY = p.progress.interpolate({ inputRange: [0, 1], outputRange: [-40, p.fall] });
        const translateX = p.progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.driftX] });
        const rotate = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${p.spin}deg`],
        });
        const opacity = p.progress.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: p.startX,
              top: 0,
              width: p.size,
              height: p.size * 7,
              backgroundColor: p.color,
              borderRadius: 1,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}

export type ClimbRow = { handle: string; value: string; isUser?: boolean };

const CLIMB_ROW_H = 58;
const CLIMB_ROW_GAP = 8;
const CLIMB_STRIDE = CLIMB_ROW_H + CLIMB_ROW_GAP;

/**
 * Animated leaderboard finale. `rows` are given in FINAL order (index 0 = #1,
 * which should be the user). The user's row starts at the bottom and climbs to
 * the top while every other row leapfrogs down one slot; `onArrive` fires once
 * the user reaches #1 (a good moment to pop confetti). Uses the RN Animated API
 * on the native driver, matching MascotRunner. Honors reduce-motion.
 */
export function LeaderboardClimb({
  rows,
  onArrive,
  userAvatar,
  climbDuration = 1700,
}: {
  rows: ClimbRow[];
  onArrive?: () => void;
  userAvatar?: ReactNode;
  climbDuration?: number;
}) {
  const n = rows.length;
  const userIndex = Math.max(0, rows.findIndex((r) => r.isUser));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [userRank, setUserRank] = useState(n);

  // Each row owns a slot Animated.Value (in slot units). Others begin one slot
  // higher (filling the top), the user begins at the very bottom.
  const slots = useRef(
    rows.map((row, i) => new Animated.Value(row.isUser ? n - 1 : Math.max(0, i - 1)))
  ).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      slots.forEach((s, i) => s.setValue(i));
      setUserRank(1);
      onArrive?.();
      return;
    }

    const userSlot = slots[userIndex];
    const id = userSlot.addListener(({ value }) => {
      setUserRank(Math.max(1, Math.round(value) + 1));
    });

    const climb = Animated.timing(userSlot, {
      toValue: 0,
      duration: climbDuration,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });

    // Bump each other row down by one, staggered so the row nearest the user
    // shifts first — producing a rung-by-rung leapfrog as the user passes it.
    const bumps = rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => !row.isUser)
      .map(({ i }) =>
        Animated.timing(slots[i], {
          toValue: i,
          duration: 260,
          delay: ((n - i) / n) * climbDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );

    const runner = Animated.parallel([climb, ...bumps]);
    runner.start(({ finished }) => {
      if (finished) {
        setUserRank(1);
        onArrive?.();
      }
    });

    return () => {
      userSlot.removeListener(id);
      runner.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <View style={{ height: n * CLIMB_STRIDE }}>
      {rows.map((row, i) => {
        const translateY = Animated.multiply(slots[i], CLIMB_STRIDE);
        const rank = row.isUser ? userRank : i + 1;
        return (
          <Animated.View
            key={row.handle}
            style={[styles.climbRow, row.isUser && styles.climbRowUser, { transform: [{ translateY }] }]}
          >
            <Text style={[styles.climbRank, row.isUser && styles.climbTextOnColor]}>#{rank}</Text>
            <View style={[styles.climbAvatar, row.isUser && styles.climbAvatarUser]}>
              {row.isUser && userAvatar ? (
                userAvatar
              ) : (
                <Ionicons name="person" size={16} color={row.isUser ? colors.black : colors.textDim} />
              )}
            </View>
            <Text
              style={[styles.climbHandle, row.isUser && styles.climbTextOnColor]}
              numberOfLines={1}
            >
              @{row.handle}
            </Text>
            <Text style={[styles.climbValue, row.isUser && styles.climbTextOnColor]}>{row.value}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  runnerWrap: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  runnerMascot: {
    zIndex: 2,
  },
  runnerShadow: {
    width: '46%',
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
    marginTop: -6,
    marginBottom: 8,
  },
  groundClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 6,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  groundRow: {
    flexDirection: 'row',
  },
  groundUnit: {
    flexDirection: 'row',
  },
  groundDash: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.borderStrong,
    marginRight: GROUND_GAP,
  },
  eyebrow: {
    ...type.label,
    color: colors.textDim,
    marginBottom: 6,
  },
  screenTitle: {
    ...type.h1,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...type.h2,
    color: colors.text,
    fontSize: 18,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: font.bold,
  },
  gradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingVertical: 17,
    borderRadius: radius.button,
  },
  gradientBtnText: {
    ...type.action,
    color: colors.black,
    textTransform: 'uppercase',
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingVertical: 16,
    borderRadius: radius.button,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghostBtnText: {
    ...type.action,
    color: colors.text,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  thinTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  thinFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.textDim,
  },
  statReadout: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statReadoutValue: {
    ...metric,
    color: colors.text,
    fontSize: 20,
    fontWeight: font.heavy,
    letterSpacing: -0.5,
  },
  statReadoutLabel: {
    ...type.micro,
    color: colors.textDim,
    fontWeight: font.bold,
  },
  pressed: {
    opacity: 0.72,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOnColor: {
    backgroundColor: 'rgba(0,0,0,0.14)',
    borderColor: 'transparent',
  },
  pillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: font.bold,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekPip: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
  },
  statTile: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 6,
  },
  statTileValue: {
    ...metric,
    color: colors.text,
    fontSize: 24,
    fontWeight: font.heavy,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  statTileLabel: { ...type.micro, color: colors.textDim, fontWeight: font.bold },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionLead: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: { ...type.h3, color: colors.text },
  optionDesc: { ...type.bodySm, color: colors.textDim, marginTop: 3 },
  optionCheck: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectChip: {
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectChipLabel: { ...metric, color: colors.text, fontSize: 18, fontWeight: font.heavy },
  selectChipSub: { color: colors.textDim, fontSize: 12, fontWeight: font.medium, marginTop: 2 },
  classRow: { flexDirection: 'row', gap: spacing.sm },
  classChip: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  classChipLabel: { ...type.micro, color: colors.textDim, fontSize: 11 },
  classChipSub: { color: colors.textFaint, fontSize: 11, fontWeight: font.medium },
  leaderboard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  leaderRowUser: { backgroundColor: colors.lime },
  leaderRank: { ...metric, width: 34, color: colors.textDim, fontSize: 14, fontWeight: font.heavy },
  leaderName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: font.semibold },
  leaderCals: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaderCalText: { ...metric, color: colors.text, fontSize: 14, fontWeight: font.bold },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topBarBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  checkbox: {
    borderRadius: radius.xs,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.lime, borderColor: colors.lime },

  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  usernameField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  usernameAt: { color: colors.textDim, fontSize: 18, fontWeight: font.heavy },
  usernameInput: { flex: 1, color: colors.text, fontSize: 17, fontWeight: font.bold, paddingVertical: 0 },
  usernameCheck: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceBtn: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },

  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.xs },
  badgeText: { ...type.micro, color: colors.black },

  climbRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: CLIMB_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  climbRowUser: { backgroundColor: colors.lime, borderColor: colors.lime },
  climbRank: { ...metric, width: 34, color: colors.textDim, fontSize: 15, fontWeight: font.heavy },
  climbAvatar: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  climbAvatarUser: { backgroundColor: 'rgba(0,0,0,0.14)' },
  climbHandle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: font.bold },
  climbValue: { ...metric, color: colors.text, fontSize: 14, fontWeight: font.heavy },
  climbTextOnColor: { color: colors.black },
});
