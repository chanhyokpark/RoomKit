import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  HintphoneConnection,
  HintphoneController,
  IDLE_HINTPHONE_SNAPSHOT,
  type HintphoneConnectionOptions,
  type HintphoneSnapshot,
} from '@roomkit/hintphone-core';

export interface HintphoneContextValue {
  connection: HintphoneConnection;
  controller: HintphoneController;
}

const HintphoneContext = createContext<HintphoneContextValue | null>(null);

/** Snapshot served before the provider has mounted (and during SSR). */
const IDLE_SNAPSHOT = IDLE_HINTPHONE_SNAPSHOT;

export interface HintphoneProviderProps {
  /**
   * Connection options, read once on mount. mode 'auto' (default) uses the
   * helper bridge inside the player and a device-code client elsewhere.
   */
  options?: HintphoneConnectionOptions;
  children?: ReactNode;
  /**
   * Replaces the built-in device-code dialog (client mode, no code yet).
   * Call `setCode` with the entered code.
   */
  renderCodeDialog?: (setCode: (code: string) => void) => ReactNode;
  /** Class hook for the built-in dialog. Default 'rk-code-dialog'. */
  dialogClassName?: string;
  /** Built-in dialog texts. */
  dialogLabels?: { title?: string; placeholder?: string; submit?: string };
}

/**
 * Sets up the RoomKit connection (client or helper, auto-detected) and makes
 * it available to the other components via context. In client mode without a
 * device code it shows a minimal unstyled `<dialog>` asking for one
 * (customizable via `renderCodeDialog`, styleable via `.rk-code-dialog`).
 */
export function HintphoneProvider({
  options,
  children,
  renderCodeDialog,
  dialogClassName = 'rk-code-dialog',
  dialogLabels,
}: HintphoneProviderProps) {
  const [value, setValue] = useState<HintphoneContextValue | null>(null);
  // Read once on mount by design — reconnecting on every options identity
  // change would tear down the socket on each parent render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const connection = new HintphoneConnection(optionsRef.current);
    const controller = new HintphoneController(connection);
    connection.connect();
    setValue({ connection, controller });
    return () => {
      controller.destroy();
      connection.destroy();
      setValue(null);
    };
  }, []);

  const snapshot = useHintphoneSnapshot(value?.controller ?? null);
  const needsCode = snapshot.connectionState === 'needs-code';
  const setCode = (code: string) => value?.connection.setDeviceCode(code);

  return (
    <HintphoneContext.Provider value={value}>
      {children}
      {needsCode &&
        (renderCodeDialog ? (
          renderCodeDialog(setCode)
        ) : (
          <CodeDialog
            className={dialogClassName}
            labels={dialogLabels}
            onSubmit={setCode}
          />
        ))}
    </HintphoneContext.Provider>
  );
}

function CodeDialog({
  className,
  labels,
  onSubmit,
}: {
  className: string;
  labels?: HintphoneProviderProps['dialogLabels'];
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) onSubmit(code);
  };
  return (
    <dialog open className={className}>
      <form className={`${className}-form`} onSubmit={handleSubmit}>
        <p className={`${className}-title`}>{labels?.title ?? '장치 코드 입력'}</p>
        <input
          className={`${className}-input`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={labels?.placeholder ?? '장치 코드'}
          autoFocus
        />
        <button type="submit" className={`${className}-submit`}>
          {labels?.submit ?? '연결'}
        </button>
      </form>
    </dialog>
  );
}

const noopSubscribe = () => () => {};

function useHintphoneSnapshot(controller: HintphoneController | null): HintphoneSnapshot {
  return useSyncExternalStore(
    controller ? (listener) => controller.subscribe(listener) : noopSubscribe,
    () => controller?.snapshot ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );
}

export interface UseHintphoneValue {
  /** Null until the provider has mounted. */
  connection: HintphoneConnection | null;
  /** Null until the provider has mounted. */
  controller: HintphoneController | null;
  /** Reactive state; an idle snapshot before mount. */
  snapshot: HintphoneSnapshot;
}

/** Reactive access to the hintphone set up by {@link HintphoneProvider}. */
export function useHintphone(): UseHintphoneValue {
  const value = useContext(HintphoneContext);
  const snapshot = useHintphoneSnapshot(value?.controller ?? null);
  return {
    connection: value?.connection ?? null,
    controller: value?.controller ?? null,
    snapshot,
  };
}
