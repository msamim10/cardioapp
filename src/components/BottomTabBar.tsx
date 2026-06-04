import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';

const TABS = [
  { href: '/' as const, label: 'HOME', icon: '🏠' },
  { href: '/community' as const, label: 'COMMUNITY', icon: '🌍' },
];

export function BottomTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {TABS.map((tab) => {
        const active = pathname === tab.href || (tab.href === '/' && (pathname === '/' || pathname === '/index'));
        return (
          <Pressable
            key={tab.href}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => {
              if (!active) router.replace(tab.href);
            }}
          >
            <Text style={styles.icon}>{tab.icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
  },
  tabActive: {},
  icon: {
    fontSize: 20,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: theme.colors.textDim,
  },
  labelActive: {
    color: theme.colors.primary,
  },
});
