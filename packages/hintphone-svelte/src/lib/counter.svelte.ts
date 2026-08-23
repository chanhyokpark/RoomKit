import {
  EMPTY_HINT_COUNTER_STATS,
  HintphoneCounterCore,
  type HintCounterStats,
} from './core.js';
import { getHintphone, type HintphoneContext } from './context.svelte.js';

/**
 * Rune-based hint usage counter (hints used, steps viewed, answers opened,
 * wrong codes). Instantiate during component initialization below a
 * `<HintphoneSetup>`:
 *
 * ```svelte
 * <script lang="ts">
 *   import { HintCounter } from '@roomkit/hintphone-svelte';
 *   const counter = new HintCounter();
 * </script>
 * 힌트 {counter.stats.hintsUsed}개 · 정답 {counter.stats.answersOpened}개
 * ```
 *
 * Counting spans the setup's connection lifetime; `reset()` zeroes it.
 */
export class HintCounter {
  /** Live usage stats. */
  stats: HintCounterStats = $state(EMPTY_HINT_COUNTER_STATS);
  #core: HintphoneCounterCore | null = null;

  constructor(ctx: HintphoneContext = getHintphone()) {
    $effect(() => {
      const connection = ctx.connection;
      if (!connection) return;
      const core = new HintphoneCounterCore(connection);
      this.#core = core;
      this.stats = core.stats;
      const unsubscribe = core.subscribe(() => (this.stats = core.stats));
      return () => {
        unsubscribe();
        core.destroy();
        this.#core = null;
        this.stats = EMPTY_HINT_COUNTER_STATS;
      };
    });
  }

  reset(): void {
    this.#core?.reset();
  }
}
