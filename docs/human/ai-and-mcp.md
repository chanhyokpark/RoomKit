# AI와 MCP 사용하기

[문서 홈](../TOC.md) · [AI 문서 목차](../TOC_AI.md)

RoomKit MCP 서버를 연결하면 AI가 테마와 애셋을 만들고, 시퀀스를 작성하고, 테스트 세션과 가상 장치를 실행해 로그를 확인할 수 있습니다.

## 실행

설치 없이 GitHub에서 바로 실행하실 수 있습니다.

```sh
pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

MCP 클라이언트 설정 예시는 다음과 같습니다.

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

### Claude Code

```sh
claude mcp add roomkit -- pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

`claude mcp get roomkit` 또는 Claude Code의 `/mcp` 명령으로 연결 상태를 확인할 수 있습니다.

### Codex

```sh
codex mcp add roomkit -- pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

`codex mcp list` 또는 Codex의 `/mcp` 명령으로 연결 상태를 확인할 수 있습니다.

## 권장 대화 흐름

1. AI에게 `docs_list`를 호출해 공식 문서 목차를 읽도록 요청해 주세요.
2. 서버 URL, 관리자 ID와 비밀번호를 알려 주고 로그인하도록 요청해 주세요.
3. 작업할 테마를 선택하거나 새 테마를 만들도록 요청해 주세요.
4. 삭제나 프로덕션 운영 전에는 AI가 대상을 다시 확인하도록 요청해 주세요.
5. 먼저 가상 장치와 테스트 세션으로 검증하고, 마지막에 실제 Player로 확인해 주세요.

예시 요청:

> 60분 제한의 새 테마를 만들고 메인 화면과 퍼즐 콘솔 장치를 추가해 주세요. 콘솔의 `code:correct` 트리거가 발생하면 효과음을 재생하고 다음 페이즈로 이동하도록 만든 뒤 가상 장치로 테스트해 주세요.

## 주의 사항

- 관리자 자격 증명은 AI 세션 메모리에 보관될 수 있습니다. 신뢰할 수 있는 세션에서만 사용해 주세요.
- 삭제 도구는 데이터를 영구적으로 삭제합니다. 직접 만든 임시 데이터가 아니라면 항상 확인해 주세요.
- 가상 장치는 즉시 완료 응답을 보내므로 실제 재생 시간과 화면은 검증하지 못합니다.
- 웹 테스트와 실제 Player 테스트에는 연결된 Player ID가 필요합니다.
- MCP 문서 도구는 저장소 `master` 브랜치의 최신 문서를 읽습니다.
