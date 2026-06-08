import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accentColor, neon } from '@/components/neon/NeonUi';
import type { ComponentProps } from 'react';
import type { UiAccent } from '@/lib/run-ui-data';

type Tab = {
  href: '/' | '/play' | '/challenges' | '/progress' | '/profile';
  label: string;
  icon: TabIconName;
  accent: UiAccent;
  aliases?: string[];
  badge?: boolean;
};

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type TabIconName = 'home' | 'gamepad' | 'trophy' | 'chart' | 'profile';

const TABS: Tab[] = [
  { href: '/', label: 'Home', icon: 'home', accent: 'lime' },
  { href: '/play', label: 'Play', icon: 'gamepad', accent: 'lime', aliases: ['/start-run', '/workout'] },
  { href: '/challenges', label: 'Challenges', icon: 'trophy', accent: 'lime', badge: true },
  { href: '/progress', label: 'Progress', icon: 'chart', accent: 'lime' },
  { href: '/profile', label: 'Profile', icon: 'profile', accent: 'lime', aliases: ['/settings'] },
];

function TabIcon({ icon, active }: { icon: TabIconName; active: boolean }) {
  const color = active ? accentColor('lime') : '#a7acba';
  const size = active ? 28 : 25;

  if (icon === 'gamepad') {
    return <Ionicons name={'game-controller' as IoniconName} size={size} color={color} />;
  }

  if (icon === 'trophy') {
    return <MaterialCommunityIcons name={'trophy' as MaterialIconName} size={size} color={color} />;
  }

  if (icon === 'chart') {
    return <Ionicons name={'bar-chart' as IoniconName} size={size} color={color} />;
  }

  if (icon === 'profile') {
    return <Ionicons name={'person' as IoniconName} size={size} color={color} />;
  }

  return <Ionicons name={'home' as IoniconName} size={size} color={color} />;
}

export function BottomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  function isActive(tab: Tab): boolean {
    if (tab.href === '/') return pathname === '/' || pathname === '/index';
    return pathname === tab.href || Boolean(tab.aliases?.includes(pathname));
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map((tab) => {
        const active = isActive(tab);
        const color = active ? accentColor(tab.accent) : '#a7acba';
        return (
          <Pressable
            key={tab.href}
            style={styles.tabPressable}
            onPress={() => {
              if (!active) router.replace(tab.href);
            }}
          >
            <View style={[styles.tabInner, active && styles.tabInnerActive]}>
              <View style={styles.iconWrap}>
                <TabIcon icon={tab.icon} active={active} />
                {tab.badge ? <View style={styles.badge} /> : null}
              </View>
              <Text style={[styles.label, { color }]} numberOfLines={1} adjustsFontSizeToFit>
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    minHeight: 74,
    flexDirection: 'row',
    paddingTop: 6,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(7,10,24,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.52)',
  },
  tabPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    minWidth: 56,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 15,
  },
  tabInnerActive: {
    backgroundColor: 'rgba(185,255,0,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(185,255,0,0.72)',
  },
  iconWrap: {
    position: 'relative',
    width: 31,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: neon.pink,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
});
