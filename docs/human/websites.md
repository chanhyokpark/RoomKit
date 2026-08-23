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

const roomkit = new RoomKitHelper();
roomkit.trigger("keypad:correct", { digits: "0417" });
roomkit.on("message", async (payload, message) => {
  if (message.messageName === "set-screen") await updateScreen(payload);
});
```

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

Studio의 **웹 테스트**에서 Player와 장치를 선택하고 Vite 개발 서버 URL을 입력해 주세요. HMR로 페이지가 다시 로드되면 Helper가 새 hello를 보내고 슬롯을 다시 선언합니다. 활동 로그에서 트리거, 메시지 처리와 완료 응답을 확인하실 수 있습니다.

웹 테스트의 트리거는 실행되지 않고 일치하는 이벤트만 기록됩니다. 힌트 요청도 실제 세션 없이 `session_not_running`으로 응답합니다. 전체 이벤트 흐름과 성공한 힌트 단계를 확인할 때는 테스트 세션을 사용해 주세요.

배포할 때는 다음 중 하나를 선택해 주세요.

- 정적 호스팅 주소를 **외부 URL** 웹사이트 애셋으로 등록해 주세요.
- 빌드 결과의 `index.html`이 ZIP 루트에 오도록 압축해 **ZIP 호스팅**으로 올려 주세요.

ZIP 호스팅 경로에서도 파일을 찾을 수 있도록 Vite의 `base`는 `./`로 설정해 주세요.
