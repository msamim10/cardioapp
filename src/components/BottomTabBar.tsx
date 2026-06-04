import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Tab = {
  href: '/' | '/workout' | '/community' | '/settings';
  label: string;
  icon: string;
  badge?: boolean;
};

const TABS: Tab[] = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/workout', label: 'Play', icon: '🎮' },
  { href: '/community', label: 'Challenges', icon: '🏆', badge: true },
  { href: '/community', label: 'Progress', icon: '📊' },
  { href: '/settings', label: 'Profile', icon: '👤' },
];

export function BottomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  function isActive(tab: Tab): boolean {
    if (tab.href === '/') {
      return pathname === '/' || pathname === '/index';
    }
    return pathname === tab.href;
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {TABS.map((tab, idx) => {
        const active = isActive(tab);
        return (
          <Pressable
            key={`${tab.href}-${idx}`}
            style={styles.tabPressable}
            onPress={() => {
              if (!active) router.replace(tab.href);
            }}
          >
            <View style={[styles.tabInner, active && styles.tabInnerActive]}>
              <View style={styles.iconWrapper}>
                <Text style={styles.icon}>{tab.icon}</Text>
                {tab.badge && (
                  <View style={styles.badge} />
                )}
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>
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
    flexDirection: 'row',
    backgroundColor: '#070a0e',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10,
    height: 72,
  },
  tabPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tabInnerActive: {
    backgroundColor: 'rgba(34,197,94,0.2)',
  },
  iconWrapper: {
    position: 'relative',
  },
  icon: {
    fontSize: 20,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#8a96a8',
  },
  labelActive: {
    color: '#22c55e',
  },
});
