import { useSyncExternalStore } from 'react';

/** 화면에 보여 줄 메시지 로그. RoomKitProvider 옵션과 페이지 양쪽에서 사용합니다. */
export interface LogEntry {
  id: number;
  text: string;
}

let logs: LogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function addLog(text: string): void {
  logs = [{ id: Date.now() + Math.random(), text }, ...logs].slice(0, 30);
  notify();
}

export function clearLogs(): void {
  logs = [];
  notify();
}

export function useLogs(): LogEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => logs,
  );
}
