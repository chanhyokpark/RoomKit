# RoomKit

방탈출 게임을 기획, 제작, 관리 및 실시간으로 운영하기 위한 올인원 툴킷

## 기능

- 애셋 통합 관리
- 비주얼 에디터
- 운영 및 테스트
- 키오스크 기능이 포함된 앱

## 서버 실행

- Node.js, pnpm, Docker 필요
- `pnpm infra`로 데이터베이스, 스토리지, 서버, 스튜디오 실행(스튜디오 url: localhost:5173)
- 기본 로그인 계정: admin/roomkit

자세한 내용은 [매뉴얼](./docs/MANUAL_KO.md) 참조

## 라이브러리 설치

`@roomkit/client`와 `@roomkit/helper`는 npm 레지스트리 없이 GitHub에서 바로 설치할 수 있습니다.
pnpm 10부터 git 의존성의 빌드 스크립트 실행을 허용해야 하므로, 사용하는 프로젝트의 `pnpm-workspace.yaml`에 먼저 추가하세요:

```yaml
onlyBuiltDependencies:
  - "@roomkit/client"
  - "@roomkit/helper"
```

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/client"
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper"
```

- 설치 시점에 저장소를 클론해 자동으로 빌드합니다(`prepare` 스크립트).
- 특정 브랜치/태그에 고정하려면 `github:chanhyokpark/RoomKit#<ref>&path:packages/client` 형태를 사용하세요.
- private 저장소인 경우 git 인증(ssh 키 등)이 필요합니다.

사용법은 [클라이언트 문서](./docs/CLIENT.md)와 [헬퍼 문서](./docs/HELPER.md) 참조

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
      "args": ["--allow-build=@roomkit/mcp", "dlx", "github:chanhyokpark/RoomKit#path:apps/mcp"]
    }
  }
}
```

자세한 내용은 [AI 연동 문서](./docs/AI.md) 참조
