import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  EMPTY_HINT_COUNTER_STATS,
  HintphoneCounterCore,
  type HintCounterStats,
} from '@roomkit/hintphone-core';
import { useHintphone } from './context.js';

const EMPTY_STATS = EMPTY_HINT_COUNTER_STATS;

export interface UseHintCounterValue {
  /** Live usage stats for the current connection. */
  stats: HintCounterStats;
  reset: () => void;
}

/**
 * Counts hint usage (hints used, steps viewed, answers opened, wrong codes)
 * on the hintphone connection from {@link HintphoneProvider}. Counting spans
 * the provider's lifetime; call `reset()` to zero it (e.g. per session).
 */
export function useHintCounter(): UseHintCounterValue {
  const { connection } = useHintphone();
  const [core, setCore] = useState<HintphoneCounterCore | null>(null);
  const coreRef = useRef<HintphoneCounterCore | null>(null);
  coreRef.current = core;

  useEffect(() => {
    if (!connection) return;
    const counter = new HintphoneCounterCore(connection);
    setCore(counter);
    return () => {
      counter.destroy();
      setCore(null);
    };
  }, [connection]);

  const stats = useSyncExternalStore(
    core ? (listener) => core.subscribe(listener) : () => () => {},
    () => core?.stats ?? EMPTY_STATS,
    () => EMPTY_STATS,
  );

  return { stats, reset: () => coreRef.current?.reset() };
}
