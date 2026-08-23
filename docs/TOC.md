# RoomKit 문서

RoomKit은 방탈출 게임의 제작, 테스트, 운영과 장치 연동을 한곳에서 처리하는 도구입니다. 처음 사용하신다면 아래의 **권장 순서**대로 읽어 주세요. 각 문서는 필요한 내용만 빠르게 찾을 수 있도록 주제별로 나누었습니다.

## 권장 읽기 순서

1. [RoomKit 이해하기](./human/overview.md) — 구성 요소와 핵심 용어를 먼저 살펴보세요.
2. [설치하고 실행하기](./human/getting-started.md) — 서버, Studio, Player를 실행해 보세요.
3. [테마 제작하기](./human/authoring.md) — 애셋, 페이즈, 이벤트와 커맨드를 구성하세요.
4. [테스트하고 운영하기](./human/operations.md) — 테스트 세션부터 실제 운영까지 확인하세요.

## 기능별 문서

| 하시려는 일 | 문서 |
| --- | --- |
| Player 안에서 실행되는 퍼즐 웹사이트 만들기 | [Helper로 웹사이트 만들기](./human/websites.md) |
| 별도 키오스크나 하드웨어 장치 연결하기 | [커스텀 장치 만들기](./human/custom-devices.md) |
| React로 힌트폰 만들기 | [힌트폰 만들기](./human/hintphone.md) |
| AI에게 테마 제작과 테스트 맡기기 | [AI와 MCP 사용하기](./human/ai-and-mcp.md) |
| 오류 원인 찾기 | [문제 해결](./human/troubleshooting.md) |

## 바로 실행할 수 있는 예제

- [`templates/hintphone`](../templates/hintphone/README.md) — React 힌트폰
- [`templates/web`](../templates/web/README.md) — Helper 기반 자막·비디오 커스텀 렌더링
- [`templates/web_custom`](../templates/web_custom/README.md) — `@roomkit/client` 기반 독립 장치

AI 에이전트나 구현 세부 계약이 필요하시면 [영문 AI 문서 목차](./TOC_AI.md)를 참고해 주세요.
