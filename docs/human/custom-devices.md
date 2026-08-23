# 커스텀 장치 만들기

[문서 홈](../TOC.md) · [React 예제](../../templates/web_custom/README.md)

`@roomkit/client`는 독립 키오스크, Raspberry Pi, 센서 브리지나 별도 웹 앱을 RoomKit 장치로 직접 연결할 때 사용합니다. Player iframe 안의 사이트에는 Client 대신 [Helper](./websites.md)를 사용해 주세요.

## 연결

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - "@roomkit/client"
```

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/client"
```

```ts
import { RoomKitClient } from '@roomkit/client';

const roomkit = new RoomKitClient({
  serverUrl: 'http://localhost:3000',
  deviceCode: 'screen-main',
  deviceName: '메인 화면',
  retryOnFatalError: true,
});

roomkit.on('status', (status, detail) => console.log(status, detail));
roomkit.connect();
```

프로덕션에서는 장치 애셋의 코드를 사용해 주세요. 테스트에서는 세션이 발급한 코드를 사용해 주세요. 브라우저는 테스트 코드를 서버 오리진별 localStorage에 보관할 수 있으므로 한 오리진에서 여러 장치를 띄울 때는 `persistTestCode: false` 또는 별도 storage를 지정해 주세요.

## 장치가 처리해야 하는 이벤트

- `play(cmd, done)`: 미디어를 재생하고 완료 또는 실패 시 `done()`을 한 번 호출해 주세요.
- `stop(cmd)`: 채널별 재생을 멈추고 관련 상태를 정리해 주세요.
- `navigate(url, cmd, done)`: 실제 화면이 준비된 뒤 `done()`을 호출해 주세요. 전체 페이지를 이동한다면 소켓이 사라지기 전에 호출해 주세요.
- `message(payload, cmd)`: 구조화된 장치 명령을 처리해 주세요. 기다리는 메시지의 listener가 반환한 Promise가 끝난 뒤 완료 응답이 전송됩니다.
- `reset`: 초기 화면과 모든 재생 상태로 돌아가 주세요.
- `progress`: 대사 라인의 자막 동기화 또는 라인 사이 커맨드의 재개 신호입니다.
- `sessionState`, `hint`, `hintError`, `hintCode`: 운영 상태와 힌트 UI를 갱신해 주세요.

## 재생 계약

Client는 미디어를 직접 재생하지 않습니다. `url`이 `null`이면 플레이스홀더이며 `durationMs`만큼 기다린 뒤 완료해 주세요.

- 반복 BGM은 재생을 시작한 시점에 완료해 주세요. 비반복 BGM, SFX와 비디오는 종료 시 완료해 주세요.
- 대사 스피커는 각 라인을 시작할 때 `sendProgress(commandId, lineIndex)`를 호출해 주세요.
- `holdBefore` 라인은 재생 전에 `sendProgress(commandId, lineIndex, true)`를 보내고 서버의 일반 progress 응답을 기다려 주세요.
- 대사 스크린 역할은 progress에 맞춰 자막을 표시하고 play 커맨드에는 즉시 완료해 주세요. 서버는 스피커 완료를 기다립니다.
- `done('failed')`도 시퀀스를 중단하지는 않으며 실패 로그를 남기고 다음 커맨드로 진행합니다.

완성형 브라우저 구현은 [`templates/web_custom`](../../templates/web_custom/README.md)을 참고해 주세요.
