import { useCallback, useEffect, useState } from 'react';
import { loadProfile } from '@/lib/storage';
import { DEFAULT_WEIGHT_KG } from '@/lib/constants';

/**
 * Loads the user's weight from AsyncStorage and returns it (with a sensible
 * default while loading). Also exposes a refresh function for after settings
 * changes.
 */
export function useUserWeight() {
  const [weightKg, setWeightKg] = useState<number>(DEFAULT_WEIGHT_KG);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const profile = await loadProfile();
    setWeightKg(profile.weightKg);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { weightKg, loaded, refresh };
}
