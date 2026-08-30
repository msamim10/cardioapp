import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius } from '@/theme';

const TABS: { name: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'levels', label: 'Levels', icon: 'grid' },
  { name: 'progress', label: 'Progress', icon: 'stats-chart' },
  { name: 'profile', label: 'Profile', icon: 'person' },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 10 }]}>
          {TABS.map((tab, index) => {
            const focused = state.index === index;
            return (
              <Pressable
                key={tab.name}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: focused }}
                onPress={() => navigation.navigate(tab.name)}
              >
                <View style={[styles.indicator, focused && styles.indicatorActive]} />
                <View style={styles.iconWrap}>
                  <Ionicons
                    name={focused ? tab.icon : (`${tab.icon}-outline` as keyof typeof Ionicons.glyphMap)}
                    size={23}
                    color={focused ? colors.lime : colors.textDim}
                  />
                </View>
                <Text style={[styles.label, focused && styles.labelActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="levels" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 0,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  // A lit rule above the active tab reads as navigation; a filled shape behind
  // the glyph reads as a badge.
  indicator: {
    alignSelf: 'stretch',
    height: 2,
    marginHorizontal: 10,
    marginBottom: 9,
    borderRadius: radius.xs,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.lime,
  },
  iconWrap: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: font.bold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.text,
    fontWeight: font.heavy,
  },
});
