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
                <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                  <Ionicons
                    name={focused ? tab.icon : (`${tab.icon}-outline` as keyof typeof Ionicons.glyphMap)}
                    size={22}
                    color={focused ? colors.black : colors.textDim}
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
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 46,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.lime,
  },
  label: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: font.semibold,
  },
  labelActive: {
    color: colors.text,
    fontWeight: font.bold,
  },
});
