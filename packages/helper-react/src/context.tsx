import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Emitter,
  IDLE_ROOMKIT_SNAPSHOT,
  RoomKitCore,
  isOutsidePlayer,
  type RoomKitApi,
  type RoomKitOptions,
  type RoomKitRelay,
  type RoomKitSnapshot,
} from './core.js';

interface RoomKitContextValue {
  /** Null until the provider's mount effect ran. */
  core: RoomKitCore | null;
  /** Stable across core re-creations — safe to subscribe before mount. */
  relay: RoomKitRelay;
}

const RoomKitContext = createContext<RoomKitContextValue | null>(null);

/** Package-internal: relay + core for the hooks. */
export function useRoomKitContext(): RoomKitContextValue | null {
  return useContext(RoomKitContext);
}

export interface RoomKitProviderProps {
  /**
   * Helper options (renders/messages/testCallbacks/lockdown/timerPollMs),
   * read once on mount — reconstructing the helper on every options identity
   * change would re-run the player handshake on each parent render.
   */
  options?: RoomKitOptions;
  children?: ReactNode;
}

/**
 * Constructs the RoomKit helper (player postMessage bridge) and makes it
 * available to the hooks/components via context. Mount once, at the top of
 * the app — navigation destroys render claims, and nested providers would
 * post duplicate hellos.
 */
export function RoomKitProvider({ options, children }: RoomKitProviderProps) {
  // The relay outlives core re-creations (StrictMode probes), so callbacks
  // registered by children before/between mounts are never lost.
  const relayRef = useRef<RoomKitRelay | null>(null);
  relayRef.current ??= new Emitter();
  const relay = relayRef.current;
  const [core, setCore] = useState<RoomKitCore | null>(null);
  // Read once on mount by design (see the options doc comment).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const next = new RoomKitCore(optionsRef.current, relay);
    setCore(next);
    return () => {
      next.destroy();
      setCore(null);
    };
  }, [relay]);

  const value = useMemo(() => ({ core, relay }), [core, relay]);
  return <RoomKitContext.Provider value={value}>{children}</RoomKitContext.Provider>;
}

const noopSubscribe = () => () => {};

function createView(core: RoomKitCore | null, snapshot: RoomKitSnapshot): RoomKitApi {
  return {
    bridge: snapshot.bridge,
    sessionMode: snapshot.sessionMode,
    remainingMs: snapshot.remainingMs,
    outsidePlayer: isOutsidePlayer(snapshot.bridge),
    subtitle: snapshot.subtitle,
    hintCode: snapshot.hintCode,
    video: snapshot.video,
    helper: core?.helper ?? null,
    hint: {
      data: snapshot.hint,
      error: snapshot.error,
      pending: snapshot.pending,
      hasPrev: snapshot.hasPrev,
      hasNext: snapshot.hasNext,
      nextIsAnswer: snapshot.nextIsAnswer,
      counts: snapshot.hintCounts,
      submit: (code) => core?.controller.submitCode(code),
      prev: () => core?.controller.prev(),
      next: () => core?.controller.next(),
      showAnswer: () => core?.controller.showAnswer(),
      dismiss: () => core?.controller.dismiss(),
      resetCounts: () => core?.resetHintCounts(),
    },
    trigger: (event, payload) => core?.trigger(event, payload),
    triggerAndWait: (event, payload, opts) =>
      core
        ? core.triggerAndWait(event, payload, opts)
        : Promise.reject(new Error('[roomkit] RoomKitProvider not mounted')),
    refreshTimer: (opts) => core?.refreshTimer(opts) ?? Promise.resolve(null),
    videoEnded: (commandId) => core?.helper.videoEnded(commandId),
    videoError: (commandId) => core?.helper.videoError(commandId),
  };
}

/**
 * The RoomKit surface set up by {@link RoomKitProvider}: reactive values
 * (bridge, session mode, auto-updating `remainingMs`, claimed slots), the
 * `hint` facade, and actions like `trigger()`. Register callbacks with
 * {@link useRoomKitMessage} / {@link useRoomKitEvent}.
 */
export function useRoomKit(): RoomKitApi {
  const ctx = useContext(RoomKitContext);
  const core = ctx?.core ?? null;
  const snapshot = useSyncExternalStore(
    core ? (listener) => core.subscribe(listener) : noopSubscribe,
    () => core?.snapshot ?? IDLE_ROOMKIT_SNAPSHOT,
    () => IDLE_ROOMKIT_SNAPSHOT,
  );
  return useMemo(() => createView(core, snapshot), [core, snapshot]);
}
