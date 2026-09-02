# RoomKit 템플릿

[RoomKit 문서 홈](../docs/TOC.md)

각 템플릿은 독립적인 프로젝트입니다. 필요한 디렉터리만 복사해서 별도 저장소에서 사용하실 수 있습니다.

| 템플릿 | 선택 기준 |
| --- | --- |
| [`web`](./web/README.md) | Player 안에서 실행되는 웹사이트를 React + Tailwind CSS로 만들 때 사용해 주세요 (`@roomkit/helper-react`). |
| [`web_svelte`](./web_svelte/README.md) | Player 안에서 실행되는 웹사이트를 SvelteKit(정적 어댑터)으로 만들 때 사용해 주세요 (`@roomkit/helper-svelte`). |
| [`hintphone`](./hintphone/README.md) | (deprecated 패키지 사용) Player 밖 독립 실행형까지 지원하는 기존 힌트폰 예제입니다. Player 안 힌트폰은 `web`/`web_svelte` 템플릿에 포함된 힌트 컴포넌트를 사용해 주세요. |
| [`web_custom`](./web_custom/README.md) | Player 없이 브라우저 자체가 RoomKit 장치로 접속해야 할 때 사용해 주세요 (`@roomkit/client`). |

각 템플릿의 README에 RoomKit 애셋 구성, Player로 실행·테스트하는 방법과 배포 방법을 정리했습니다.
