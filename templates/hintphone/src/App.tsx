import {
  HintInput,
  HintphoneProvider,
  HintRenderer,
  useHintCounter,
  useHintphone,
} from "@roomkit/hintphone-react";

export function App() {
  return (
    <HintphoneProvider
      options={{ mode: "helper", lockdown: import.meta.env.PROD }}
      dialogLabels={{
        title: "장치 코드",
        placeholder: "코드를 입력해 주세요",
        submit: "연결",
      }}
    >
      <Hintphone />
    </HintphoneProvider>
  );
}

function Hintphone() {
  const { snapshot } = useHintphone();
  const { stats, reset } = useHintCounter();

  return (
    <main className="shell">
      <header className="titlebar">
        <div>
          <h1>힌트폰</h1>
        </div>
        <span className={`status status-${snapshot.connectionState}`}>
          {connectionLabel(snapshot.connectionState)}
        </span>
      </header>

      <section className="panel input-panel" aria-label="힌트 코드 입력">
        <HintInput
          variant="text"
          maxLength={4}
          labels={{
            submit: "힌트 확인",
            clear: "지우기",
            backspace: "한 글자 삭제",
          }}
        />
      </section>

      <section className="panel result-panel" aria-live="polite">
        <HintRenderer
          labels={{
            prev: "이전",
            next: "다음",
            showAnswer: "정답 보기",
            answer: "정답",
            close: "닫기",
          }}
          empty={<p className="empty">힌트가 이곳에 표시됩니다.</p>}
        />
      </section>

      <footer className="stats">
        <span>사용한 힌트 {stats.hintsUsed}</span>
        <span>확인한 단계 {stats.stepsViewed}</span>
        <span>정답 확인 {stats.answersOpened}</span>
        <span>잘못된 코드 {stats.wrongCodes}</span>
        <button type="button" onClick={reset}>
          통계 초기화
        </button>
      </footer>
    </main>
  );
}

function connectionLabel(state: string) {
  switch (state) {
    case "connected":
      return "연결됨";
    case "connecting":
      return "연결 중";
    case "needs-code":
      return "코드 필요";
    case "error":
      return "연결 오류";
    default:
      return "연결 대기";
  }
}
