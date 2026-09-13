import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Universal-link landing route: `https://cardiosurf.com/l/{id}?c={runId}`
 * maps here through expo-router's path matching and forwards to the level
 * screen in the custom-scheme shape (`/level/{id}?challenge=`).
 */
export default function ShortLinkRedirect() {
  const { id, c } = useLocalSearchParams<{ id: string | string[]; c?: string | string[] }>();
  const levelId = Array.isArray(id) ? id[0] : id;
  const challenge = Array.isArray(c) ? c[0] : c;
  if (!levelId) return <Redirect href="/(tabs)" />;
  return (
    <Redirect
      href={{ pathname: '/level/[id]', params: { id: levelId, ...(challenge ? { challenge } : {}) } }}
    />
  );
}
