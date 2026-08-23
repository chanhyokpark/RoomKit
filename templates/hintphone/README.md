# React 힌트폰 템플릿

[RoomKit 문서 홈](../../docs/TOC.md) · [힌트폰 문서](../../docs/human/hintphone.md)

Player 안에서 실행되는 React 힌트폰 예제입니다. `@roomkit/hintphone-react`가 내부적으로 `@roomkit/helper`를 사용하도록 `mode: 'helper'`를 고정했습니다. 코드 입력, 단계 이동, 정답, 오류와 현재 페이지의 사용 통계를 포함합니다.

## 설치하고 실행하기

필요한 환경은 Node.js 22 이상과 pnpm 10입니다.

```sh
pnpm install
pnpm dev
```

개발 서버는 기본적으로 `http://localhost:5173`에서 열립니다. 일반 브라우저에서는 화면만 확인할 수 있고, 실제 힌트 응답은 Player 안에서만 받을 수 있습니다.

## RoomKit 구성하기

1. Studio에서 장치 애셋을 만들고 **힌트 장치**를 켜 주세요.
2. 고유 코드와 단계, 필요한 경우 정답을 가진 힌트 애셋을 만들어 주세요.
3. Player를 실행하고 Studio의 **웹 테스트**로 이동해 주세요.
4. 연결된 Player와 힌트 장치를 선택하고 개발 서버 URL을 입력해 주세요.
5. **테스트 시작**을 누른 뒤 만든 힌트 코드를 입력해 주세요.

`App.tsx`의 `maxLength`는 예제에서 네 자리로 설정했습니다. 더 긴 코드를 사용하시면 함께 변경해 주세요. 디자인은 `.rk-hint*`, `.rk-hint-input*` 클래스와 `style.css`에서 조정하실 수 있습니다.

## 테스트하기

정적 검사는 다음 명령으로 실행해 주세요.

```sh
pnpm typecheck
pnpm build
```

웹 테스트에서는 다음을 확인해 주세요.

- 올바른 코드가 첫 단계와 이미지를 표시하는지 확인해 주세요.
- 이전/다음 버튼과 마지막 단계의 **정답 보기**가 동작하는지 확인해 주세요.
- 잘못된 코드와 세션이 시작되지 않은 상태의 오류 문구를 확인해 주세요.
- 운영 화면에서 힌트를 강제로 전송했을 때도 표시되는지 확인해 주세요.
- 페이지를 새로고침한 뒤 다시 연결되는지 확인해 주세요.

## 배포하기

```sh
pnpm build
```

`dist/`의 **내용물**을 압축해 `index.html`이 ZIP 루트에 오도록 만들어 주세요. Studio에서 ZIP 호스팅 웹사이트 애셋으로 업로드한 뒤, 힌트 장치 대상 **웹사이트 이동** 커맨드로 열어 주세요. `vite.config.ts`의 `base: './'` 설정은 `/api/sites/{assetId}/` 아래에서도 JS와 CSS를 찾기 위해 필요합니다.

외부 정적 호스팅을 사용하셔도 됩니다. 이 경우 HTTPS Player 환경에서는 사이트도 HTTPS로 제공해 주세요.

## 독립 실행형으로 바꾸기

Player 없이 브라우저가 직접 장치로 접속하게 하려면 Provider 옵션을 `mode: 'client'`로 바꾸고 `serverUrl`과 선택적인 `deviceCode`를 전달해 주세요. 완전한 독립 장치 예시는 [`../web_custom`](../web_custom/README.md)을 참고해 주세요.
