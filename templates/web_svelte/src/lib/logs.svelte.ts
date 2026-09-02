/** 화면에 보여 줄 메시지 로그. 레이아웃의 메시지 핸들러가 기록합니다. */
export const logs: { id: number; text: string }[] = $state([]);

export function addLog(text: string): void {
  logs.unshift({ id: Date.now() + Math.random(), text });
  if (logs.length > 30) logs.length = 30;
}

export function clearLogs(): void {
  logs.length = 0;
}
