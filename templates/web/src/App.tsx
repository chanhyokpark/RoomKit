import { RoomKitProvider, useRoomKit, useRoomKitMessage } from '@roomkit/helper-react';
import { addLog, clearLogs, useLogs } from './logs';

export function App() {
  return (
    // Helper는 앱 최상단(top layout)에서 한 번만 초기화하세요. 옵션은 mount 시
    // 한 번만 읽히며, 페이지를 새로 이동(navigation)하면 선언이 사라집니다.
    <RoomKitProvider
      options={{
        // 일반 브라우저에서 개발할 때 우클릭·텍스트 선택을 막지 않습니다.
        lockdown: import.meta.env.PROD,
        // ── 메시지 선언 ─────────────────────────────────────────────────
        // 이 사이트가 처리하는 메시지 애셋 이름 목록입니다. Player에 보고되어
        // 테스트 세션의 디버그 창 목록에서 바로 보낼 수 있습니다(전달 자체는
        // 이 목록과 무관합니다). 실제 처리는 페이지에서 useRoomKitMessage로
        // 등록하세요.
        messages: ['announce'],
        // 디버그 창에서 인자 없이 실행할 수 있는 테스트 콜백입니다(테스트 세션 전용).
        testCallbacks: {
          'clear-logs': clearLogs,
        },
      }}
    >
      <Page />
    </RoomKitProvider>
  );
}

function Page() {
  const rk = useRoomKit();
  const logs = useLogs();

  // ── 메시지 처리 ────────────────────────────────────────────────────────
  // 이름을 넘기면 해당 메시지만, 핸들러만 넘기면 모든 메시지를 받습니다.
  // waitUntilEnd 메시지는 핸들러가 반환한 Promise가 끝난 뒤에 ack됩니다.
  useRoomKitMessage((payload, envelope) => {
    addLog(`${envelope.messageName}: ${JSON.stringify(payload)}`);
  });

  return (
    <main>
      {rk.outsidePlayer && (
        <p role="alert">
          ⚠️ 이 페이지가 RoomKit Player 밖에서 열렸습니다. Player 런처의 테스트
          탭에서 웹사이트 URL 대체로 실행해 주세요.
        </p>
      )}

      {/* ── 페이지 콘텐츠 ────────────────────────────────────────────────
          아래 디버그 출력을 지우고 여기에 테마 페이지를 만드세요. Tailwind CSS
          클래스를 바로 사용할 수 있고, 게임 이벤트는
          rk.trigger('이벤트이름', payload)로 서버에 보고합니다.
          힌트폰이 필요하면 <HintInput />과 <HintRenderer hint={rk.hint} />를
          사용하세요. */}
      <p>bridge: {rk.bridge}</p>
      <p>sessionMode: {rk.sessionMode}</p>
      <p>remainingMs: {rk.remainingMs ?? '(타이머 없음)'} (자동 갱신)</p>
      <p>hint: {JSON.stringify(rk.hint.data)}</p>

      <p>메시지 로그:</p>
      {logs.length === 0 ? (
        <p>아직 받은 메시지가 없습니다. 디버그 창에서 announce를 보내 보세요.</p>
      ) : (
        logs.map((log) => <p key={log.id}>{log.text}</p>)
      )}
    </main>
  );
}
