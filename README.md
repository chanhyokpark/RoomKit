# RoomKit

방탈출 게임을 기획, 제작, 관리 및 실시간으로 운영하기 위한 올인원 툴킷

## 기능

- 태그, ZIP 일괄 업로드, 테마 복제·내보내기·가져오기를 포함한 애셋 통합 관리
- 페이즈, 트리거, 커맨드 시퀀스를 구성하는 비주얼 에디터
- 테스트/프로덕션 세션, 실시간 로그와 운영 콘솔
- 미디어 캐시, 다중 장치 창, 테스트 세션 디버그 창과 키오스크 잠금을 제공하는 Player 앱
- 커스텀 장치, Player 내 웹사이트, React/Svelte 힌트폰용 라이브러리
- 테마 제작과 가상 장치 테스트를 자동화하는 MCP 서버

## 서버 실행

- Node.js, pnpm, Docker 필요
- `pnpm infra`로 데이터베이스, 스토리지, 서버, Studio 실행(Studio: http://localhost:5173)
- 기본 로그인 계정: admin/roomkit
- Player는 별도 앱이며 `pnpm dev:player`로 실행

자세한 내용은 [RoomKit 문서](./docs/TOC.md)를 참고해 주세요.

## 라이브러리 설치

`@roomkit/client`, `@roomkit/helper`와 힌트폰 컴포넌트 라이브러리(`@roomkit/hintphone-react`, `@roomkit/hintphone-svelte`)는 npm 레지스트리 없이 GitHub에서 바로 설치할 수 있습니다.
pnpm 10부터 git 의존성의 빌드 스크립트 실행을 허용해야 하므로, 사용하는 프로젝트의 `pnpm-workspace.yaml`에 먼저 추가하세요:

```yaml
onlyBuiltDependencies:
  - "@roomkit/client"
  - "@roomkit/helper"
  - "@roomkit/hintphone-react"
  - "@roomkit/hintphone-svelte"
```

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/client"
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper"
pnpm add "github:chanhyokpark/RoomKit#path:packages/hintphone-react"
pnpm add "github:chanhyokpark/RoomKit#path:packages/hintphone-svelte"
```

- 설치 시점에 저장소를 클론해 자동으로 빌드합니다(`prepare` 스크립트).
- 특정 브랜치/태그에 고정하려면 `github:chanhyokpark/RoomKit#<ref>&path:packages/client` 형태를 사용하세요.
- private 저장소인 경우 git 인증(ssh 키 등)이 필요합니다.

사용법은 [커스텀 장치 문서](./docs/human/custom-devices.md), [Helper 웹사이트 문서](./docs/human/websites.md), [힌트폰 문서](./docs/human/hintphone.md)를 참고해 주세요. 바로 실행할 수 있는 프로젝트는 [React 템플릿](./templates/README.md)에 있습니다.

### MCP 서버

MCP 서버는 단일 파일로 번들되어 별도 설치 없이 실행할 수 있습니다:

```sh
pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

MCP 클라이언트 설정(`.mcp.json`) 예시:

```json
{
  "mcpServers": {
    "roomkit": {
      "command": "pnpm",
      "args": [
        "--allow-build=@roomkit/mcp",
        "dlx",
        "github:chanhyokpark/RoomKit#path:apps/mcp"
      ]
    }
  }
}
```

자세한 내용은 [AI와 MCP 문서](./docs/human/ai-and-mcp.md)를 참고해 주세요. AI 에이전트용 상세 영문 문서는 [TOC_AI.md](./docs/TOC_AI.md)에서 시작합니다.
