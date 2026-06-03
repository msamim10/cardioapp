import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  paused: boolean;
  active: boolean;
};

/**
 * Tracks the wall-clock duration of an active session, supports pause/resume,
 * and ticks display state once per second to keep the HUD readable without
 * forcing a re-render every frame.
 *
 * `getElapsedSec()` always returns the up-to-the-millisecond elapsed time
 * regardless of when the last tick happened (useful for the final snapshot).
 */
export function useWorkoutTimer({ paused, active }: Options) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const segmentStartRef = useRef<number | null>(null);
  const accumulatedSecRef = useRef(0);

  const getElapsedSec = useCallback(() => {
    const live =
      segmentStartRef.current === null
        ? 0
        : (Date.now() - segmentStartRef.current) / 1000;
    return accumulatedSecRef.current + live;
  }, []);

  useEffect(() => {
    if (!active) {
      segmentStartRef.current = null;
      accumulatedSecRef.current = 0;
      setElapsedSec(0);
      return;
    }
    if (paused) {
      if (segmentStartRef.current !== null) {
        accumulatedSecRef.current += (Date.now() - segmentStartRef.current) / 1000;
        segmentStartRef.current = null;
        setElapsedSec(accumulatedSecRef.current);
      }
      return;
    }
    if (segmentStartRef.current === null) {
      segmentStartRef.current = Date.now();
    }
    const id: ReturnType<typeof setInterval> = setInterval(() => {
      setElapsedSec(getElapsedSec());
    }, 1000);
    return () => clearInterval(id);
  }, [paused, active, getElapsedSec]);

  return { elapsedSec, getElapsedSec };
}
