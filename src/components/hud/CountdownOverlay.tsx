import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/lib/theme';

type Props = {
  seconds?: number;
  onComplete: () => void;
};

export function CountdownOverlay({ seconds = 3, onComplete }: Props) {
  const [count, setCount] = useState(seconds);
  const [showGo, setShowGo] = useState(false);

  useEffect(() => {
    if (count > 0) {
      const id = setTimeout(() => setCount((c) => c - 1), 900);
      return () => clearTimeout(id);
    }
    if (!showGo) {
      setShowGo(true);
      const id = setTimeout(onComplete, 550);
      return () => clearTimeout(id);
    }
  }, [count, showGo, onComplete]);

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.scrim} />
      <View style={styles.center}>
        <Text style={styles.eyebrow}>GET READY</Text>
        <Text style={[styles.big, showGo && styles.go]}>
          {showGo ? 'GO!' : count}
        </Text>
        <Text style={styles.hint}>
          Place phone flat on a table. Run, jump and dodge with the camera.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,14,20,0.55)',
  },
  center: { alignItems: 'center', paddingHorizontal: 32 },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 4,
    marginBottom: 12,
  },
  big: {
    color: theme.colors.text,
    fontSize: 140,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(34,211,238,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  go: {
    color: theme.colors.primary,
    fontSize: 96,
  },
  hint: {
    color: theme.colors.text,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    opacity: 0.9,
  },
});
