# AI와 CLI 사용하기

[문서 홈](../TOC.md) · [AI 스킬(영문)](../../skills/roomkit/SKILL.md)

RoomKit CLI(`rk`)로 웹사이트 프로젝트를 만들고 배포하며, 테마·애셋·시퀀스 제작과 테스트 세션·가상 장치까지 터미널에서 다룰 수 있습니다. 사람에게는 대화형 프롬프트와 한국어 안내를, 프로그램과 AI 에이전트에게는 `--json` 출력을 제공합니다.

## 설치

Node.js 22 이상과 pnpm 10 이상이 필요합니다.

```sh
pnpm add -g --allow-build=@roomkit/cli "github:chanhyokpark/RoomKit#path:apps/cli"
rk --help
```

`--allow-build` 는 설치 시 저장소를 클론해 빌드하는 `prepare` 스크립트를 허용합니다. 새 버전이 있으면 명령 실행 후 한 줄로 알려 주며, `rk upgrade` 로 같은 명령을 다시 실행해 업데이트합니다 (`rk version --check` 로 바로 확인).

## 로그인

```sh
rk login
```

서버 주소, 관리자 ID, 비밀번호를 입력하면 `~/.roomkit/mcp-credentials.json` 에 저장되고(권한 600, MCP 서버와 공유) 이후 모든 명령이 자동으로 로그인합니다. CI 에서는 `ROOMKIT_URL`/`ROOMKIT_ID`/`ROOMKIT_PASSWORD` 환경 변수나 `--url/--id/--password` 옵션을 사용해 주세요. `rk logout` 으로 삭제합니다.

## 웹사이트 프로젝트 만들기

```sh
rk init
```

대화형으로 다음을 묻습니다.

1. 생성 위치 (비어 있는 디렉터리). 상위에 `roomkit.json` 이 있으면 그 프로젝트에 웹사이트를 추가합니다.
2. 연결할 테마 (선택 또는 새로 만들기)
3. 연결할 website 애셋 (선택, 새로 만들기, 나중에)
4. 템플릿: React (`templates/web`) 또는 Svelte (`templates/web_svelte`) — GitHub 에서 최신 템플릿을 내려받습니다.
5. `pnpm install` 실행 여부
6. 스킬을 설치할 AI 도구 (Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, AGENTS.md)

모든 질문은 옵션으로 대신할 수 있습니다 (`rk init --help`). 예:

```sh
rk init --dir site --template react --theme "스텔라호" --create-asset "메인 화면" --asset-key main --ai claude,codex --yes
```

웹사이트 프로젝트를 만들지 않고 **테마 지정과 AI 스킬 설치만** 하려면 `rk init ai` 를 사용합니다. 이미 있는 저장소나 테마 제작용 작업 폴더에서 실행하면 됩니다.

```sh
rk init ai                                        # 대화형: 테마 선택/생성 → AI 도구 선택
rk init ai --theme "스텔라호" --ai claude --yes    # 옵션으로 지정
```

상위에 `roomkit.json` 이 있으면 그 프로젝트의 테마와 스킬을 갱신하고, 없으면 현재 디렉터리(`--dir`)에 새로 만듭니다. `websites` 항목은 만들지 않으므로 나중에 `rk init` 으로 웹사이트를 추가하거나 `rk deploy --save` 로 등록할 수 있습니다.

생성이 끝나면 프로젝트 루트에 `roomkit.json` 이 만들어집니다.

```json
{
  "version": 1,
  "server": "http://localhost:3000",
  "theme": { "id": "…", "name": "스텔라호" },
  "websites": [
    {
      "name": "main",
      "dir": ".",
      "assetId": "…",
      "assetKey": "main",
      "build": "pnpm build",
      "dist": "dist",
      "dev": { "command": "pnpm dev", "url": "http://localhost:5173" }
    }
  ],
  "test": { "devices": ["main-screen"] },
  "ai": { "tools": ["claude", "codex"] }
}
```

- `theme`: 이 프로젝트가 작업하는 테마. `rk theme use <이름>` 으로 바꿉니다. 모든 테마 관련 명령이 이 값을 사용하며 `--theme` 옵션으로 한 번만 바꿀 수 있습니다.
- `websites`: 배포 대상. `dir` 은 `roomkit.json` 기준 상대 경로(단일 프로젝트는 `.`), `build` 는 그 디렉터리에서 실행할 빌드 명령, `dist` 는 `index.html` 이 있는 빌드 결과 디렉터리입니다.
- `websites[].dev`: `rk dev` 가 사용하는 개발 서버. `command` 는 `dir` 에서 실행할 명령(`null` 이면 이미 떠 있다고 가정), `url` 은 테스트 세션 동안 이 웹사이트 애셋을 대신할 주소입니다. 포트를 바꿨다면 `url` 도 맞춰 주세요.
- `test.devices`: `rk dev` 가 창을 열 장치 애셋(키/코드/이름). 비워 두면 개발 웹사이트를 시작 페이지로 쓰는 장치를 자동으로 고릅니다.
- 비밀 정보는 없으므로 커밋해도 됩니다.

## 개발 서버로 테스트하기

```sh
rk dev
```

`websites[].dev` 의 개발 서버가 떠 있지 않으면 실행하고, 그 주소로 **웹사이트 URL 대체**가 걸린 테스트 세션을 만든 뒤, 이 컴퓨터의 Player 앱을 **앱 링크**(`roomkit-player://test?server=…&session=…`)로 열어 장치 창과 디버그 창을 띄웁니다. 터미널에는 세션 로그가 흐르고 Ctrl-C 를 누르면 세션을 종료하고 개발 서버도 정리합니다. 세션 시작은 디버그 창에서 하거나 `--start` 를 붙입니다.

- `rk dev --devices main-screen,console --save`: 열 장치를 지정하고 `test.devices` 에 저장
- `rk dev --host auto`: 다른 기기의 Player 가 접근할 수 있도록 대체 URL 의 localhost 를 이 컴퓨터의 LAN 주소로 바꿈
- `rk dev --player <런처 id>`: 앱 링크 대신 서버에 연결된 Player 런처에 창을 열도록 요청 (태블릿 등 원격 Player)
- `rk dev --json --no-open`: 세션만 만들고 종료 (AI 에이전트용). `rk session end <id>` 로 정리합니다.

앱 링크가 열리지 않으면(Player 미설치, 또는 macOS 에서 `tauri dev` 로 실행한 개발용 Player) Player 테스트 탭의 **세션 ID로 열기**에 출력된 세션 id 를 붙여 넣으면 같은 창이 열립니다. Player 런처의 테스트 탭에서 직접 테마·장치·URL 대체를 고르는 방법은 [Player 문서](./player.md)에 있습니다.

## 배포

```sh
rk deploy            # websites 항목이 하나면 바로, 여러 개면 선택
rk deploy main       # 이름 지정
rk deploy --all --no-build
```

빌드 → `dist` 압축 → 서버 업로드 → website 애셋을 **ZIP 호스팅** 모드로 전환합니다. 사이트 주소는 `{서버}/api/sites/{애셋 id}/` 로 고정되며 재배포해도 바뀌지 않습니다. `roomkit.json` 없이 직접 지정하려면 `rk deploy --dir . --asset main --dist dist --save` 처럼 실행합니다.

## AI 에이전트에게 맡기기

`rk skill install` 은 CLI 에 번들된 **roomkit 스킬**(영문 문서 묶음)을 프로젝트에 설치합니다. AI 도구가 이 스킬을 읽고 `rk --json` 으로 작업합니다.

| 도구                     | 설치 위치                                                               |
| ------------------------ | ----------------------------------------------------------------------- |
| Claude Code              | `.claude/skills/roomkit/`                                               |
| Codex, Cursor, AGENTS.md | `.agents/skills/roomkit/` + `AGENTS.md` 관리 블록                       |
| Gemini CLI               | `.agents/skills/roomkit/` + `GEMINI.md` 관리 블록                       |
| GitHub Copilot           | `.agents/skills/roomkit/` + `.github/copilot-instructions.md` 관리 블록 |

`.agents/skills/` 는 Agent Skills 표준의 공용 위치로 Codex, Cursor, Gemini CLI, Copilot 이 모두 자동으로 읽습니다 (2026-09 각 벤더 문서 기준).

관리 블록은 `<!-- roomkit-skill:start -->` … `<!-- roomkit-skill:end -->` 사이만 갱신하며 나머지 내용은 건드리지 않습니다. 스킬 파일은 `rk` 가 덮어쓰므로 직접 수정하지 말고, CLI 를 업데이트한 뒤 `rk skill install` 로 갱신해 주세요 (`rk skill status` 가 버전 차이를 알려 줍니다).

권장 대화 흐름:

1. 서버 URL 과 관리자 계정으로 `rk login` 을 먼저 해 두세요 (AI 에게 비밀번호를 넘기지 않아도 됩니다).
2. `rk init`, `rk init ai` 또는 `rk theme use` 로 프로젝트 테마를 정해 두세요.
3. AI 에게 스킬을 읽고 작업하도록 요청하세요. 예: "힌트 장치와 퍼즐 콘솔 장치를 추가하고, 콘솔의 `code:correct` 트리거에 효과음 재생 후 다음 페이즈로 이동하는 이벤트를 만든 뒤 가상 장치로 테스트해 줘."
4. 삭제나 프로덕션 세션 운영 전에는 AI 가 대상을 다시 확인하도록 요청해 주세요.

## 테마 제작과 테스트

- 테마: `rk theme list|create|update|duplicate|export|import|delete`
- 태그·애셋: `rk tag …`, `rk asset list|get|create|update|delete` (`rk asset create` 는 옵션 없이 실행하면 마법사), `rk upload <파일> --set <애셋>`, `rk import media sfx <zip>`
- 시퀀스: `rk sequence get <이벤트> --outline`, `rk sequence edit <이벤트> --ops @ops.json`, `rk sequence set`, `rk sequence validate`
- 세션: `rk session create|start|pause|resume|end|phase|trigger|hint|timer|command|logs|summary|delete` · 개발 서버와 Player 로 바로 테스트: `rk dev`
- 가상 장치: `rk device connect --session <id>` (연결을 유지하며 받은 커맨드를 출력) · `rk device trigger <코드> <이벤트>`

애셋은 uuid 대신 `key`(테마 안에서 유일한 슬러그)로 참조할 수 있습니다. 입력 형식은 `rk describe commands`, `rk describe asset <종류>` 로 확인할 수 있고, 전체 명령 설명은 `rk <명령> --help` 와 [CLI 레퍼런스(영문)](../../skills/roomkit/references/cli.md)에 있습니다.

## 주의 사항

- 자격 증명은 평문으로 저장됩니다. 신뢰할 수 있는 컴퓨터에서만 사용해 주세요.
- 삭제 명령은 데이터를 영구적으로 지웁니다. 터미널에서는 확인을 묻고, `--json`/`--yes` 에서는 `--yes` 가 있어야 실행됩니다.
- 가상 장치는 즉시 완료 응답을 보내므로 실제 재생 시간과 화면은 검증하지 못합니다.
- `rk init` 의 템플릿 다운로드와 `rk docs --remote` 는 GitHub 접근이 필요합니다.
