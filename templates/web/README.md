# React 웹사이트 템플릿

[RoomKit 문서 홈](../../docs/TOC.md) · [Helper 문서](../../docs/human/websites.md)

Player iframe 안에서 실행되는 웹사이트의 최소 템플릿입니다. Vite + React + Tailwind CSS에 [`@roomkit/helper-react`](../../docs/human/websites.md)를 사용합니다. 메인 페이지는 RoomKit 원시 값과 메시지 로그를 보여 주는 빈 페이지이며, Player 밖에서 열리면 경고를 표시합니다. 채워 넣어야 하는 부분(메시지 등록, 페이지 콘텐츠)은 `src/App.tsx`의 한국어 주석으로 표시했습니다.

## 설치하기

```sh
pnpm install
```

`pnpm-workspace.yaml`이 GitHub 패키지(`@roomkit/helper-react`)의 빌드 스크립트를 허용합니다. `vite.config.ts`는 Player가 같은 네트워크에서 접근할 수 있도록 모든 인터페이스에 개발 서버를 열고, ZIP 호스팅을 위해 상대 base를 사용합니다.

## Player로 실행하고 테스트하기

1. Studio에서 화면 장치와 웹사이트 애셋(주소는 example.com이어도 됩니다), 필요한 메시지 애셋(예: `announce`)을 만들어 주세요.
2. 개발 서버를 시작해 주세요.

   ```sh
   pnpm dev
   ```

3. Player 런처의 **테스트** 탭에서 테마와 장치를 선택하고 **웹사이트 URL 대체**에 개발 서버 URL(예: `http://<내 IP>:5173`)을 입력해 테스트 세션을 시작해 주세요.
4. 테스트 세션의 디버그 창에서 이 페이지가 등록한 메시지(`announce`)와 테스트 콜백(`clear-logs`)을 바로 보내고 실행할 수 있습니다. 받은 메시지는 페이지의 메시지 로그에 표시됩니다.

일반 브라우저에서 직접 열면 Player 브리지가 없으므로 경고가 표시되고 트리거·타이머 요청이 동작하지 않습니다.

## 커스터마이즈하기

- `src/App.tsx`의 한국어 주석 위치에 메시지 핸들러와 페이지 콘텐츠를 채워 넣으세요. 스타일은 Tailwind CSS 클래스를 사용하면 됩니다.
- 힌트 UI(코드 입력·단계 탐색), 자막·비디오·힌트 코드를 사이트가 직접 렌더링하는 방법(render claims), `trigger`/`getRemainingTime` 등 전체 API는 [Helper 문서](../../docs/human/websites.md)를 참고해 주세요. 이 템플릿은 자막과 비디오를 렌더링하지 않으며, 기본값 그대로 Player가 오버레이를 그립니다.

## 배포하기

```sh
pnpm build
```

`dist/` 내용물을 ZIP으로 압축해 `index.html`이 루트에 오도록 올리시거나 정적 호스팅에 배포해 주세요. ZIP은 Studio의 **ZIP 호스팅** 웹사이트로, 외부 주소는 **외부 URL** 웹사이트로 등록해 주세요.
