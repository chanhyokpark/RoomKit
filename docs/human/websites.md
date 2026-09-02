# Helper로 웹사이트 만들기

[문서 홈](../TOC.md) · [React 예제](../../templates/web/README.md) · [Svelte 예제](../../templates/web_svelte/README.md)

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
  // 처리하는 메시지 이름 목록(디버그 창 표시용 선언, 전달을 거르지 않습니다)
  messages: ["set-screen"],
  testCallbacks: {
    "화면-깜빡이기": () => flashScreen(),
  },
});
roomkit.on("message", (payload, envelope) => {
  if (envelope.messageName === "set-screen") return updateScreen(payload);
});
roomkit.trigger("keypad:correct", { digits: "0417" });
```

메시지 처리는 `roomkit.on("message", ...)`으로 등록하고 `envelope.messageName`으로 분기해 주세요 — 페이지가 여러 개인 사이트도 페이지별로 필요한 핸들러만 등록하면 됩니다. `messages` 옵션은 이름 목록 선언일 뿐이며, 선언한 이름은 Player 디버그 창 목록에 표시되어 바로 전송해 볼 수 있습니다. `testCallbacks`에는 인자 없는 테스트용 함수를 등록해 주세요(테스트 세션 전용).

`getRemainingTime()`은 Player가 알고 있는 남은 시간을 가져옵니다. 페이지를 제거할 때는 `destroy()`를 호출해 주세요. `triggerAndWait()`는 트리거가 시작한 모든 이벤트가 끝날 때까지 기다리지만 **권장하지 않습니다** — 게임 흐름은 서버 시퀀스가 주도하고, 사이트는 `trigger()`만 보낸 뒤 서버가 보내는 메시지로 다음 상태를 표시하는 편이 안전합니다.

## React·Svelte 래퍼 (권장)

React나 Svelte 5를 사용하신다면 `RoomKitHelper`를 직접 만들지 말고 래퍼 패키지를 사용해 주세요.

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper-react"
# 또는
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper-svelte"
```

Helper는 **앱 최상위 레이아웃에서 한 번만** 초기화해 주세요(React는 루트 컴포넌트, SvelteKit은 루트 `+layout.svelte`). 옵션은 mount 시 한 번만 읽힙니다. React는 `<RoomKitProvider options={...}>` + `useRoomKit()`, Svelte는 `<RoomKitSetup options={...}>` + `getRoomKit()`을 사용합니다. 둘 다 같은 모양의 `rk` 객체를 돌려줍니다.

```svelte
<script lang="ts">
  import { getRoomKit, HintRenderer } from '@roomkit/helper-svelte';
  const rk = getRoomKit();
  // 콜백은 이 컴포넌트가 사라질 때 자동 해제됩니다(rk.destroy()로 수동 해제도 가능).
  rk.onMessage('set-screen', (payload) => applyScreen(payload));
</script>
{#if rk.outsidePlayer}<p>Player 안에서 열어 주세요.</p>{/if}
남은 시간 {Math.ceil((rk.remainingMs ?? 0) / 1000)}초  <!-- 자동 갱신 -->
<button onclick={() => rk.trigger('door:open')}>문 열기</button>
<HintRenderer hint={rk.hint} />
```

- 반응형 값: `rk.bridge`·`rk.outsidePlayer`(Player 밖 경고용), `rk.sessionMode`, `rk.remainingMs`(자동 갱신 타이머), claim한 슬롯의 `rk.subtitle`/`rk.hintCode`/`rk.video`. Svelte는 템플릿·`$effect`에서, React는 리렌더로 관찰합니다.
- 힌트: `rk.hint.data`(현재 단계), `rk.hint.submit/prev/next/showAnswer/dismiss()`, 사용량 `rk.hint.counts`. `<HintInput />`·`<HintRenderer hint={rk.hint} />`로 힌트폰도 이 래퍼로 만들 수 있습니다.
- 콜백: Svelte는 `rk.onMessage(...)`/`rk.onHintUpdate(...)`/`rk.on(...)`, React는 `useRoomKitMessage(...)`/`useRoomKitEvent(...)` 훅으로 등록합니다. 이름 없이 핸들러만 넘기면 모든 메시지를 받습니다.

기존 `@roomkit/hintphone-react`/`@roomkit/hintphone-svelte`는 deprecated이며, Player 밖 독립 실행형 장치는 [`@roomkit/client`](./custom-devices.md)를 사용해 주세요. 실행 가능한 예제는 [`templates/web`](../../templates/web/README.md)(React)과 [`templates/web_svelte`](../../templates/web_svelte/README.md)(SvelteKit)입니다.

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
