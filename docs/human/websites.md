# Helper로 웹사이트 만들기

[문서 홈](../TOC.md) · [React 예제](../../templates/web/README.md)

Player의 iframe 안에 표시되는 웹사이트는 `@roomkit/helper`를 사용해 주세요. Helper는 서버에 직접 연결하지 않고 `postMessage`로 Player의 기존 장치 연결을 사용합니다. 일반 브라우저나 별도 키오스크처럼 Player 밖에서 실행되는 사이트에는 [`@roomkit/client`](./custom-devices.md)를 사용해 주세요.

## 설치

pnpm 10에서는 GitHub 패키지의 빌드를 허용해 주세요.

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - "@roomkit/helper"
```

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper"
```

```ts
import { RoomKitHelper } from "@roomkit/helper";

const roomkit = new RoomKitHelper({
  messages: {
    "set-screen": async (payload) => updateScreen(payload),
  },
  testCallbacks: {
    "화면-깜빡이기": () => flashScreen(),
  },
});
roomkit.trigger("keypad:correct", { digits: "0417" });
```

Helper 0.4.0부터는 위처럼 `messages`에 메시지 이름별 handler를, `testCallbacks`에 인자 없는 테스트용 함수를 등록해 주세요. 등록한 이름은 서버에 보고되어 Player 디버그 창에서 목록으로 보고 바로 전송·실행할 수 있습니다. 테스트 콜백은 테스트 세션에서만 실행됩니다. 기존 `roomkit.on("message", ...)`도 동작하지만 `messages` 옵션 사용을 권장합니다.

`triggerAndWait()`는 트리거가 시작한 모든 이벤트가 끝날 때까지 기다립니다. `getRemainingTime()`은 Player가 알고 있는 남은 시간을 가져옵니다. 페이지를 제거할 때는 `destroy()`를 호출해 주세요.

## 커스텀 렌더링

Player는 기본적으로 자막, 힌트 코드와 비디오를 직접 표시합니다. 사이트가 직접 표시하려면 생성할 때 슬롯을 선언해 주세요.

```ts
const roomkit = new RoomKitHelper({
  renders: { subtitle: true, hintCode: false, video: true },
});
```

자막 데이터는 `{ html, css, params, lineIndex, lineCount }`이며 `null`은 자막을 지우라는 뜻입니다. `html`과 `css`는 신뢰하는 관리자가 작성한 입력으로 취급해 주세요.

비디오를 맡으면 사이트가 오디오를 포함한 재생 전체를 책임집니다.

```ts
roomkit.on("videoPlay", (video) => {
  if (!video.url) return; // 플레이스홀더는 Player가 시간에 맞춰 완료 처리합니다.
  element.src = video.url;
  element.onended = () => roomkit.videoEnded(video.commandId);
  element.onerror = () => roomkit.videoError(video.commandId);
  void element.play();
});

roomkit.on("videoStop", () => element.pause());
```

정상 종료나 오류 보고를 빠뜨리면 **끝날 때까지 대기** 중인 시퀀스가 멈춥니다. 새 비디오나 stop 이벤트가 오면 이전 핸들러와 재생 상태를 정리해 주세요.

## 개발과 배포

Player 런처의 **테스트** 탭에서 테마와 장치를 선택하고 **웹사이트 URL 대체**에 Vite 개발 서버 URL을 입력해 테스트를 시작해 주세요. 실제 테스트 세션이 열리므로 트리거로 실행되는 이벤트, 타이머와 힌트 흐름을 그대로 확인할 수 있고, 디버그 창에서 등록한 메시지 전송, 테스트 콜백 실행과 로그를 확인하실 수 있습니다. HMR로 페이지가 다시 로드되면 Helper가 새 hello를 보내고 슬롯과 등록 이름을 다시 선언합니다.

배포할 때는 다음 중 하나를 선택해 주세요.

- 정적 호스팅 주소를 **외부 URL** 웹사이트 애셋으로 등록해 주세요.
- 빌드 결과의 `index.html`이 ZIP 루트에 오도록 압축해 **ZIP 호스팅**으로 올려 주세요.

ZIP 호스팅 경로에서도 파일을 찾을 수 있도록 Vite의 `base`는 `./`로 설정해 주세요.
