# React Helper 웹사이트 템플릿

[RoomKit 문서 홈](../../docs/TOC.md) · [Helper 문서](../../docs/human/websites.md)

Player iframe 안에서 `@roomkit/helper`를 사용하며, 기본 Player 오버레이 대신 React가 자막과 비디오를 직접 렌더링하는 예제입니다. 중요한 슬롯 선언과 완료 응답 계약을 소스의 한국어 주석으로 설명했습니다.

## 설치하고 실행하기

```sh
pnpm install
pnpm dev
```

`vite.config.ts`는 Player가 같은 네트워크에서 접근할 수 있도록 모든 인터페이스에 개발 서버를 열고, ZIP 호스팅을 위해 상대 base를 사용합니다.

## Studio에서 구성하기

1. 화면으로 사용할 장치와 그 장치를 스크린으로 지정한 플레이어 애셋을 만들어 주세요.
2. 웹사이트 애셋을 만드세요(사이트 주소는 example.com을 사용하세요)
3. 자막이 있는 대사와 비디오 애셋을 만들어 주세요.
4. 대사의 **파라미터 (JSON)**에 선택적으로 `{ "speaker": "관측자", "align": "left" }`를 입력해 주세요.
5. 비디오 파라미터에는 선택적으로 `{ "objectFit": "contain", "muted": false }`를 입력해 주세요.
6. Studio **웹 테스트**에서 Player, 장치와 URL을 선택해 시작해 주세요.

`use-roomkit-helper.ts`의 `renders` 설정에서 `subtitle`과 `video`를 `true`로 선언합니다. 선언한 슬롯은 Player가 전혀 렌더링하지 않으므로 코드를 제거하실 때는 claim도 함께 끄셔야 합니다.

## 커스터마이즈하기

- 자막 HTML은 `dangerouslySetInnerHTML`로 렌더링합니다. Studio 작성자를 신뢰할 수 있는 환경에서만 사용해 주세요.
- 자막 CSS는 현재 자막과 함께 `<style>`로 적용하며 자막이 바뀌거나 사라지면 React가 교체합니다.
- `params`는 자유 형식 JSON입니다. 예제의 `speaker`, `align`, `objectFit`, `muted` 키를 프로젝트 계약에 맞게 변경해 주세요.
- 비디오 `frame`은 화면 백분율 좌표입니다. `null`이면 전체 화면을 사용합니다.
- 파일 없는 비디오는 Player가 완료 시간을 관리하므로 예제는 `videoEnded()`를 호출하지 않습니다.

## 테스트하기

```sh
pnpm typecheck
pnpm build
```

웹 테스트에서 다음 시나리오를 확인해 주세요.

- 대사 재생 시 라인별 자막, Studio 자막 CSS와 JSON params가 적용되는지 확인해 주세요.
- 대사 정지와 재생 종료 시 자막이 사라지는지 확인해 주세요.
- 실제 비디오가 끝나면 기다리는 이벤트가 다음 커맨드로 진행하는지 확인해 주세요.
- 잘못된 비디오 URL 또는 자동 재생 거부 시 실패 응답 후 시퀀스가 진행하는지 확인해 주세요.
- 비디오 정지와 새 비디오 교체 시 이전 재생이 사라지는지 확인해 주세요.
- 플레이스홀더 비디오가 지정 시간 동안 표시되는지 확인해 주세요.
- 버튼 트리거와 메시지가 활동 패널에 기록되는지 확인해 주세요.

## 배포하기

```sh
pnpm build
```

`dist/` 내용물을 ZIP으로 압축해 `index.html`이 루트에 오도록 올리시거나 정적 호스팅에 배포해 주세요. ZIP은 Studio의 **ZIP 호스팅** 웹사이트로, 외부 주소는 **외부 URL** 웹사이트로 등록해 주세요.

HTTPS 사이트에서는 Player가 전달한 비디오 URL을 그대로 사용해 주세요. 캐시된 파일은 Helper가 안전한 `blob:` URL로 바꾸며, stop 또는 교체 후에는 그 URL을 보관하지 마세요.
