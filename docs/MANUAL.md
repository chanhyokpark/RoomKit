# RoomKit — User Manual

RoomKit is a toolkit for building, managing, and running escape room games. A creator authors the game (media, devices, puzzles-as-events) in a web **Studio**, an operator runs live sessions from the same Studio, and in-room devices (screens, speakers, kiosks, sensors) execute commands pushed from the server in real time — either through the **Player** desktop app or through the `@roomkit/client` library.

This manual covers the whole system: concepts, setup, authoring, operation, and the client/helper integration APIs. The Studio and Player UIs are in Korean; UI terms are quoted verbatim (e.g. **새 테마**, **세션 시작**). For the original design decisions, see [SPEC.md](./SPEC.md).

---

## 1. Concepts and Architecture

### 1.1 Components

```
                 ┌──────────────────────────────────────────────┐
                 │              apps/server (NestJS)            │
   REST /api     │  auth · themes · assets · sessions · logs    │
  ┌─────────────▶│  runtime (sequence engine, timer, eval)      │
  │              │  gateway (Socket.io /device /admin /player)  │
  │              │  storage (S3 presign, zip import, sites)     │
  │              └──────┬───────────────┬───────────────────────┘
  │                     │               │
  │              Postgres (Prisma)   S3 / MinIO (media files)
  │
  │   Socket.io /admin ▲          Socket.io /device ▲   /player ▲
  │                    │                            │           │
┌─┴────────────────────┴─┐      ┌───────────────────┴───────────┴──────┐
│  apps/studio           │      │  apps/player (Tauri)                 │
│  SvelteKit SPA         │      │  launcher + stage windows            │
│  authoring + operation │      │  built on @roomkit/client            │
└────────────────────────┘      │  ┌────────────────────────────────┐  │
                                │  │ website iframe                 │  │
   any custom device ───────────┤  │ (@roomkit/helper, postMessage) │  │
   (@roomkit/client)            │  └────────────────────────────────┘  │
                                └──────────────────────────────────────┘
```

| Part | What it is |
|---|---|
| `apps/server` | NestJS main server: REST API (`/api` prefix), Socket.io gateways, and the sequence runtime (event engine, countdown timer, eval sandbox). Postgres via Prisma; media on S3/MinIO. |
| `apps/studio` | SvelteKit SPA for the admin. Four workspaces per theme: **애셋** (asset management), **에디터** (event/sequence authoring), **운영** (live session operation), **웹 테스트** (website test harness, §6.5). |
| `apps/player` | Tauri desktop app for in-room devices. A launcher window opens stage windows (one per device) that play audio/video/subtitles and embed websites. |
| `@roomkit/client` | TypeScript library any device uses to connect to the server directly over Socket.io. The Player is built on it. Workspace-only package. |
| `@roomkit/helper` | Tiny (~KB) script embedded in websites shown *inside the Player's iframe*. Talks to the Player via `postMessage` — no server connection of its own. |
| `@roomkit/shared` | Zod schemas for everything on the wire: asset data, commands, protocol events, helper envelopes. Single source of truth for server/studio/client. |

### 1.2 Terminology

| Term | Meaning |
|---|---|
| **Theme (테마)** | One escape room game. Every asset, phase, event, and session belongs to exactly one theme. Themes can be duplicated (deep copy) for multi-room operation or season backups, and exported/imported as zip. |
| **Asset (애셋)** | Any authored object in a theme. Kinds: 장치(device), 플레이어(player), BGM, 효과음(SFX), 대사(dialogue), 비디오(video), 이미지(image), 파일(file), 웹사이트(website), 메시지(message), 힌트(hint), 페이즈(phase), 이벤트(event). All share `이름`, `설명`, `태그`; devices and hints also carry a theme-unique `코드`. |
| **Device (장치)** | A logical endpoint in the room — a screen, speaker, kiosk, sensor bridge. Identified by a `코드` used to connect. A device can be flagged **힌트 장치** to run the hint code-entry flow. |
| **Player asset (플레이어)** | A logical *output group*: a 스피커 장치 (plays audio) + a 스크린 장치 (renders subtitles/video) + 자막 CSS. Playback commands target a player asset, not a raw device. Not to be confused with the Player *app*. |
| **Phase (페이즈)** | A game progression stage (ordered). A running session is always in exactly one phase (or none, if the theme only uses common events). |
| **Event (이벤트)** | The unit of game logic: a trigger + a sequence of commands. Belongs to a phase or is **공통** (common — valid in every phase). |
| **Trigger** | What starts an event: **장치 트리거** (a device reports an event name), **수동 트리거** (operator button), or **시스템 트리거** (세션 시작 `session:start`, 페이즈 시작 `phase:enter`, 페이즈 종료 `phase:leave`, 타이머 만료 `timer:expired`). |
| **Sequence / Command (커맨드)** | An ordered list of commands stored on an event and executed by the server runtime. See §4.4 for the full command reference. |
| **Session (세션)** | One live run of a theme. `mode` is **프로덕션** (one concurrent per theme; physical devices auto-attach by their codes) or **테스트** (many concurrent; devices attach with operator-issued test codes). States: 시작 전(created) → 진행 중(running) ⇄ 일시정지(paused) → 종료됨(ended). |
| **Hint (힌트)** | A code (4-digit by default) + ordered steps (HTML text, optional image). Players type the code on a hint device; steps are revealed one at a time. |
| **Message (메시지)** | A payload *schema* (typed fields) for sending structured data to a device. Values are filled in when authoring a **메시지 전송** command. |
| **Tag (태그)** | Color + name label for organizing assets. Filtering only — no runtime meaning. |
| **Placeholder media** | BGM/SFX/video assets and dialogue lines created without a file. They carry a duration and clients simulate playback for that long — lets you author and test sequences before real media exists. |

### 1.3 How a game runs, end to end

1. The creator authors assets and events in Studio; sequences live on the server.
2. Devices connect over Socket.io `/device` with a device code and receive a `welcome`.
3. The operator starts a session (**세션 시작**) — the timer arms and the `session:start` event fires, followed by `phase:enter` for the initial phase.
4. Devices report triggers (`trigger`), the server runs matching events' sequences, and pushes wire commands (play/stop/navigate/reset/message/hintCode) back to devices. Commands with **끝날 때까지 대기** block the sequence until the device acks.
5. The operator watches logs, device status, and running events live; can trigger manual events, switch phases, adjust the timer, and push hints.
6. A **테마 종료** command records the verdict (성공/실패) and ends the session; between teams the operator starts a fresh session (with an optional bulk device reset).

Delivery is at-least-once: every wire command has a UUID; unacked commands are redelivered on reconnect and clients dedupe by id. Offline devices don't stall the game — a send to an offline device is logged as failed and the sequence continues immediately, even for waited commands; a command delivered to an online device that never acks times out after 15 minutes.

---

## 2. Getting Started

Prerequisites: Node ≥ 22, pnpm 10.x (`packageManager` pinned in the root `package.json`), Docker (for infra), and — only for the Player desktop build — a Rust toolchain (≥ 1.77.2).

### 2.1 Infrastructure

Development infra is docker compose (`docker-compose.yml`):

| Service | Host port | Notes |
|---|---|---|
| Postgres 17 | **5433** | user/password/db all `roomkit` (also creates `roomkit_test` for e2e) |
| MinIO | **9000** (S3), **9001** (console) | root `roomkit` / `roomkit123`; bucket `roomkit` auto-created |

Two ways to run it:

```sh
docker compose up     # infra only (postgres + minio) — for host dev servers
pnpm infra            # or ./compose.sh — the FULL stack incl. server + studio
                      # (docker profile "app"; foreground, Ctrl+C stops cleanly)
```

`pnpm infra` is the zero-setup path: it builds and runs the server (port 3000) and studio (port 5173) in Docker with working defaults, including a default admin login of **`admin` / `roomkit`**. For day-to-day development you usually run `docker compose up` for infra and the dev servers on the host, as below.

> Docker gotcha: the compose server image goes stale when you change server code — restart `./compose.sh` (rebuild) rather than wondering why your change isn't live.

### 2.2 Server

Copy `apps/server/.env.example` to `apps/server/.env`. The defaults match docker compose; the fields you must set:

- `DATABASE_URL` — `postgresql://roomkit:roomkit@localhost:5433/roomkit`
- `JWT_SECRET` — any string ≥ 16 chars
- `ADMIN_ID` / `ADMIN_PASSWORD_HASH` — the single admin account. There is no users table or seed; the account lives entirely in env. Generate the bcrypt hash:
  ```sh
  cd apps/server
  node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'yourpassword'
  ```
- `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`, `S3_BUCKET=roomkit`, `S3_ACCESS_KEY_ID=roomkit`, `S3_SECRET_ACCESS_KEY=roomkit123`, `S3_FORCE_PATH_STYLE=true`
- `S3_PUBLIC_ENDPOINT` (optional) — the endpoint *browsers/devices* use for presigned URLs, when it differs from the server's route to MinIO (in compose: internal `http://minio:9000`, public `http://localhost:9000`)
- `PUBLIC_SERVER_URL` (optional) — externally reachable server origin, used to build hosted-website URLs for the **웹사이트 이동** command (defaults to `http://localhost:PORT`)

Apply migrations, then start:

```sh
pnpm --filter server exec prisma migrate deploy
pnpm dev:server        # builds @roomkit/shared, then nest start --watch on :3000
```

Production: `pnpm --filter server build` then `pnpm --filter server start:prod`. All REST routes live under the `/api` prefix; `GET /api/health` is a public liveness check.

### 2.3 Studio

```sh
pnpm --filter studio dev    # vite dev server on :5173
```

Set `PUBLIC_API_URL` in `apps/studio/.env` (copy from `.env.example`) if the server is not at `http://localhost:3000` — base server URL, no `/api`, no trailing slash. It is inlined at build time. Studio is a CSR-only SPA; the JWT is kept in `localStorage` and expires after 12 hours or on any auth failure, returning you to `/login`.

### 2.4 Player

```sh
pnpm dev:player                 # tauri dev — desktop app, frontend on :5175
pnpm --filter player dev:web    # browser-only harness, no Rust needed
pnpm --filter player build:app  # production desktop build (tauri build)
```

The browser harness has no native asset cache or kiosk lock — media streams from presigned URLs and `localStorage` replaces the config file. Port 5175 is fixed (studio owns 5173/5174).

### 2.5 Shared package rebuilds

`@roomkit/shared` is consumed from its built `dist` by the server; the studio aliases it to source. After changing shared schemas, rebuild (`pnpm --filter @roomkit/shared build` — `pnpm dev:server` does this automatically) so the server and types pick it up. When adding fields to shared schemas, make them `.default()`/`.optional()` so older clients keep validating.

---

## 3. Logging In and Managing Themes

Open Studio → `/login`. Enter the admin **아이디** and **비밀번호** (from the server env) and press **로그인**.

The sidebar has the theme switcher on top and the **메뉴**: **애셋**, **에디터**, **운영**, **웹 테스트** — the four workspaces of the current theme. **로그아웃** is at the bottom.

The theme switcher button shows the current theme and its time limit (**제한 시간 N분** or **타이머 없음**). Its dropdown:

- **새 테마** — create. Fields: **이름**, **제한 시간 (분)** (leave empty for no countdown timer).
- **테마 수정** — rename / change the time limit.
- **테마 복제** — deep copy. Every asset is duplicated and every cross-reference (player device refs, event phases, sequence targets) is remapped to the copies; device/hint codes copy verbatim (they're unique *per theme*); media files are shared with the original, not re-uploaded. Use for multiple rooms of one game or season backups.
- **테마 내보내기** — download the theme (assets + tags + media files) as a zip.
- **테마 가져오기** — import such a zip as a new theme.
- **테마 삭제** — deletes the theme **and all of its assets**, irreversibly (confirmation dialog: **취소** / **삭제**).

---

## 4. Creating a Theme in Studio

The typical authoring order: devices → players → media → websites/messages/hints → phases → events.

### 4.1 Asset management (애셋)

The asset page is the kind-tab strip on top, asset list below, and an edit panel that opens for the selected asset.

- **Kind tabs**, grouped 장치 · 미디어 · 콘텐츠 · 진행: **장치**, **플레이어** | **BGM**, **효과음**, **대사**, **비디오**, **이미지**, **파일** | **웹사이트**, **메시지**, **힌트** | **페이즈**, **이벤트**.
- **태그 필터** (default **모든 태그**) narrows the list; **태그 관리** opens the tag dialog (create with color + name, rename/recolor/delete inline).
- **새 {kind}** (e.g. **새 BGM**, **새 대사**) creates an asset; every asset row/card has a **⋯** menu with **수정** and **삭제**.
- 장치/플레이어/BGM/효과음/비디오/이미지/파일 render as cards (BGM/효과음 cards have an inline play button; 비디오 opens a preview); the remaining kinds (대사, 웹사이트, 메시지, 힌트, 페이즈, 이벤트) render as tables (**이름**, **코드**, **정보**, **태그**).
- **ZIP 업로드** appears for bulk-uploadable kinds — see §4.2.

Common form fields for every kind: **이름** (required), **설명** (optional note), **태그**, and — for 장치/힌트 — **코드** (hint code placeholder: **비워 두면 4자리 자동 생성**). **저장** / **취소** to commit.

Per-kind fields:

| Kind | Fields |
|---|---|
| **장치** (device) | **코드** (theme-unique; devices connect with it), **표시 이름**, **힌트 장치** switch (this device runs the hint code-entry UI), **힌트 코드 CSS** (styles the default `.rk-hint-code` overlay shown by the **힌트 코드 표시** command). |
| **플레이어** (player) | **스피커 장치**, **스크린 장치**, **대사 중 BGM 볼륨 (%)** / **효과음 중 BGM 볼륨 (%)** (BGM ducking — the BGM volume while dialogue/SFX plays, 0–100; empty = no ducking), **자막 CSS** (applied to the default `.rk-subtitle` subtitle overlay). |
| **BGM** | **파일**, **재생 시간 (ms)** (placeholder duration when fileless), **페이드 인 (ms)**, **페이드 아웃 (ms)**. |
| **효과음** (SFX) | **파일**, **재생 시간 (ms)**. |
| **비디오** (video) | **파일**, **재생 시간 (ms)**, **전체 화면** switch — turn it off to place the video surface at an **X/Y/너비/높이** rect (percent of the screen, with a mini placement preview), **파라미터 (JSON)** (free-form JSON forwarded with the play data when a website renders the video — see §6). |
| **이미지** (image) | **파일** — a static resource for websites, served publicly at `/api/media/{assetId}`; fileless images serve a generated placeholder with a configurable ratio. |
| **파일** (file) | **파일** — arbitrary-file counterpart of 이미지, same public URL. |
| **대사** (dialogue) | **재생 후 자막 유지** switch, **파라미터 (JSON)** (free-form JSON forwarded with the subtitle data when a website renders subtitles — see §6), **라인 (재생 순서)** — ordered lines, each with a voice file, duration, and **자막 (HTML 허용)**. **라인 추가** appends. |
| **웹사이트** (website) | **사이트 종류**: **외부 URL** (register a URL) or **ZIP 호스팅** (upload a static-site zip — `index.html` at root, a single wrapping folder is auto-stripped; served by the server at `/api/sites/{assetId}/`; **ZIP 재업로드** swaps the content atomically). |
| **메시지** (message) | **표시 이름**, **페이로드 스키마** — fields with key, label, type (**문자열**/**숫자**/**불리언**/**JSON**), **필수 값**. Defines the shape only; values are entered in the **메시지 전송** command. |
| **힌트** (hint) | **코드**, **단계 (순서대로 공개)** — each step is HTML text (**힌트 내용 (HTML 허용)**) + optional image. **단계 추가** appends. **파라미터 (JSON)** (free-form JSON forwarded with the hint-code data when a website renders it — see §6). |
| **페이즈** (phase) | **순서** (ascending progression order). Usually managed from the editor's **페이즈 관리** instead. |
| **이벤트** (event) | Trigger settings + sequence. Authored in the editor — see §4.3. |

Media files upload directly to S3 via presigned URLs (the server only handles metadata). Leave the file empty to create a **placeholder** asset — playback is simulated for **재생 시간** ms so sequences are testable before media exists; placeholders are excluded from device pre-caching.

### 4.2 Bulk ZIP upload

For BGM/효과음/대사/비디오, the **ZIP 업로드** button imports every media file in a zip as a new asset named after its filename (always creates, no dedup). Filenames must be UTF-8; junk entries (`__MACOSX/`, dotfiles, unsupported extensions) are skipped and reported.

Dialogue grouping: files named `이름_1.mp3`, `이름_2.mp3`, … become one 대사 asset named `이름` with lines ordered by the numeric suffix; files without a suffix become single-line dialogues. Subtitles are filled in afterwards on the edit screen.

### 4.3 The editor (에디터): phases and events

The editor is phase tabs on top (**공통** first, then each phase; **페이즈 관리** to create/rename/reorder/delete phases — deleting a phase moves its events to 공통), an event list on the left, and the sequence editor on the right.

**새 이벤트** creates an event. Its metadata (**메타데이터 수정** on an open event):

- **페이즈** — a specific phase, or **공통 (모든 페이즈)**. Only events of the session's *current* phase (plus common ones) can run; out-of-phase triggers are ignored and logged.
- **트리거 종류**:
  - **장치 트리거** — fires when a device reports the **트리거 이름** (e.g. `door-open`) via `trigger`.
  - **수동 트리거** — fired only from the operation screen.
  - **시스템 트리거** — pick a **시스템 훅**: **세션 시작** (`session:start`), **페이즈 시작** (`phase:enter`), **페이즈 종료** (`phase:leave`), **타이머 만료** (`timer:expired`). Phase hooks belong to a phase; starting a session also fires 페이즈 시작 for the initial phase.
- **수동 실행 허용** — also expose this event as a button on the operation screen (any trigger kind).
- **재진입 허용** — allow re-triggering while the event is already running (blocked by default). Sequences of *different* events always run in parallel.
- **1회만 실행** — once run, the event won't run again in the same session. Restarting a phase (**재시작**, §5.2) clears the run records of that phase's events.

The sequence editor is a vertical command stack: add from the **커맨드 팔레트** (searchable, grouped **재생** / **장치** / **흐름** / **타이머** / **운영**), drag to reorder, and use the row menu (**위로**/**아래로**/**복제**/**삭제**). Edits autosave (**저장됨** / **저장 중** / **저장 실패** + **재시도**). Rows warn about dangling references (**삭제된 애셋을 참조합니다**) and missing params (**입력하지 않은 항목이 있습니다**) — the runtime skips (and logs) commands with null/dangling refs rather than failing the sequence.

Every asset dropdown in a command has a **새 {kind} 만들기** option that creates the asset inline and selects it.

### 4.4 Command reference

Playback commands target a **플레이어** asset (speaker/screen pair); device commands target a **장치**.

| Command (팔레트 name) | Group | Parameters | Behavior |
|---|---|---|---|
| **대사 재생** | 재생 | 대사, 플레이어, **끝날 때까지 대기**, **라인 사이 커맨드** | Voice to the speaker device, per-line subtitles to the screen device — the default overlay styled by the player's 자막 CSS, or the embedded website when it has claimed subtitle rendering (§6). Line timing is synced from the speaker via progress relay. **라인 사이 커맨드** wedges a mini-sequence into the gap after a chosen line: the speaker holds before the next line, the cue commands run in order, then playback continues (**끝날 때까지 대기** spans cue time too). Cues are anchored to the line, so they survive reordering in the asset editor; a cue whose line was deleted (or is the last line) is skipped with a warning. |
| **대사 정지** | 재생 | 플레이어, **모든 플레이어** | Stop dialogue on one player, or all. |
| **효과음 재생** | 재생 | 효과음, 플레이어, **끝날 때까지 대기** | SFX, mixed over BGM/dialogue. Fire-and-forget unless waited. |
| **효과음 정지** | 재생 | 플레이어, **모든 플레이어** | |
| **비디오 재생** | 재생 | 비디오, 플레이어, **끝날 때까지 대기** | Plays on the screen device — fullscreen, or at the video asset's placement rect. If the embedded website has claimed video rendering (§6), the Player shows no video element at all: the site plays the media itself (audio included) and reports the end of playback. |
| **비디오 정지** | 재생 | 플레이어, **모든 플레이어** | |
| **BGM 재생** | 재생 | BGM, 플레이어, **반복 재생**, **끝날 때까지 대기** | Fade in/out follow the BGM *asset's* 페이드 인/아웃 settings. Non-looping BGM can be waited on; a looping BGM acks on start, so **끝날 때까지 대기** is unavailable while **반복 재생** is on. |
| **BGM 정지** | 재생 | 플레이어, **모든 플레이어** | Applies the asset's fade-out. |
| **장치 리셋** | 장치 | 장치 | Sends `reset` — the device returns to its initial state (Player: stops all playback, clears the stage). |
| **모든 장치 리셋** | 장치 | — | Reset every device in the session. |
| **웹사이트 이동** | 장치 | 장치, 웹사이트, **쿼리 파라미터** | Navigates the device to the website (Player: shows it in the stage iframe). Query params (key/value pairs, **쿼리 파라미터 추가**) are appended to the site URL; values support `{{vars.이름}}` / `{{payload.이름}}` interpolation (§4.5 session vars / trigger payload). The device acks once the site actually loaded, so the next command can assume readiness. |
| **메시지 전송** | 장치 | 장치, 메시지, values, **끝날 때까지 대기** | Values are entered per the message asset's field schema; delivered to the device (Player relays it into the iframe for the helper). String values support `{{vars.이름}}` / `{{payload.이름}}` interpolation — a value that is exactly one template keeps the variable's JSON type (number, boolean, …). With **끝날 때까지 대기** the sequence waits until the site's `message` handlers finish — an async handler's returned promise gates the ack. |
| **웹사이트에 요청 전송** | 장치 | 웹사이트, path, HTTP method, body, headers, **끝날 때까지 대기** | Sends an HTTP request from the RoomKit server to a URL resolved from the website asset and path. Path, body, and header names/values support `{{vars.이름}}` / `{{payload.이름}}` interpolation. GET/HEAD ignore the body. With **끝날 때까지 대기**, the sequence waits until the complete response body is received; network and non-2xx failures are logged and do not stop the sequence. |
| **힌트 코드 표시** | 장치 | 힌트, 장치 | Shows the hint's entry code as an overlay on the device — the default overlay styled by the device's 힌트 코드 CSS, or the embedded website when it has claimed hint-code rendering (§6). |
| **힌트 코드 숨김** | 장치 | 장치, **모든 장치** | Hides the overlay. |
| **대기** | 흐름 | 시간 (ms) | Server-side timer; pauses together with session pause. |
| **페이즈 전환** | 흐름 | 페이즈 | Switches phase and runs the leave/enter hooks (leave hooks complete before the switch). |
| **이벤트 호출** | 흐름 | 이벤트, **끝날 때까지 대기** | Runs another event's sequence (reuse). Fire-and-forget unless waited. Recursion depth capped at 8. |
| **JavaScript 실행** | 흐름 | code | Runs in the server sandbox — see §4.5. Returning `false` stops the sequence (guard/branching). |
| **테마 종료** | 흐름 | **판정** (성공/실패) | Game over: resets every device, records the verdict (shown on the operation screen), and ends the session. |
| **타이머 조정** | 타이머 | **동작**: 시간 조정 (±ms) / 일시정지 / 재개 | Bonus/penalty time or pause/resume of the countdown. Adjusting a running timer below zero expires it; a paused timer is clamped just above zero instead and expires on resume. |
| **알림 보내기** | 운영 | 메시지 | Shows a toast on the operation screen (e.g. "puzzle 3 solved — watch the door"). |

### 4.5 The eval sandbox (JavaScript 실행)

Code runs synchronously in a server-side `node:vm` context with a 1-second timeout (a hang guard — eval code is trusted admin input, like subtitle HTML). The injected `ctx` API:

```js
ctx.vars              // session variables (get/set; persisted, visible to parallel runs)
ctx.payload           // the trigger payload of this run (read; null when none)
ctx.phase             // current phase name, or null (read)
ctx.trigger(name)     // fire an event (same admission rules as a device trigger)
ctx.log(msg)          // write to the session log
ctx.switchPhase(name) // queued: runs after the script returns
ctx.notify(msg)       // queued: toast on the operation screen
ctx.adjustTimer(x)    // queued: number (±ms) or 'pause' / 'resume'
ctx.endTheme(v)       // queued: 'success' | 'fail'
```

Queued actions validate their arguments immediately (a bad argument throws and stops the sequence) but execute after the script returns, in call order. `return false` stops the sequence — the idiomatic guard:

```js
// only proceed if the team has found all three keys
ctx.vars.keys = (ctx.vars.keys ?? 0) + 1;
if (ctx.vars.keys < 3) return false;
ctx.notify('모든 열쇠 발견!');
```

### 4.6 Custom rendering beyond CSS

When CSS on the default overlays isn't enough — a chat screen beside a small video, animated subtitles, a themed hint-code badge — build it into the **website** shown on the device: a site embedded via the helper script can claim subtitle / hint-code / video rendering per slot and receive the data (plus the asset's **파라미터 (JSON)** and the authored CSS) to render however it likes. See §6.

---

## 5. Testing and Running a Theme

Everything live happens in **운영**: a session list on the left, the dashboard for the selected session on the right.

### 5.1 Sessions

- **프로덕션 세션 만들기** — creates an idle production session. Only one non-ended production session may exist per theme. Physical devices whose 코드 matches a device asset of the theme attach to it automatically — even *before* it exists, devices wait in a lobby and attach the moment the session is created.
- **테스트 세션 만들기** — many can run concurrently. The dialog has two tabs:
  - **연결된 플레이어** — pick a Player app registered on the server (by its **플레이어 이름**). Codes are auto-generated per device and the Player's launcher opens all stage windows automatically. If empty: start the Player app and connect it to the server first.
  - **직접 입력** — type a test code per device yourself (6 chars, lowercase letters and digits excluding 0/1/i/l/o; the form pre-fills suggestions, persisted per theme). Give these codes to any client — Player launcher entries, `@roomkit/client` consumers, etc. Codes are freed when the session ends.
- Sessions are created **idle** (**시작 전**) — devices can connect so you can verify their online status before starting.
- **세션 시작** opens a confirm dialog (**세션을 시작할까요?**): it warns about offline devices (**오프라인 장치가 있습니다:** — **그래도 시작** to proceed anyway) and offers **시작 전 모든 디바이스 초기화**. Starting arms the timer and fires 세션 시작 + the initial 페이즈 시작.
- **일시정지** / **재개** pause the whole session (timer, 대기 commands, playback state broadcast). **세션 종료** stops all running sequences, detaches devices, and frees test codes; ended sessions can't restart. Created/ended sessions can be deleted (**세션 삭제** — removes logs too).

### 5.2 The dashboard cards

- **타이머** — countdown with badges (**시작 전** / **일시정지** / **시간 초과**), adjust buttons **-5분 / -1분 / +1분 / +5분**, and **일시정지**/**재개** (independent from session pause). Themes without a limit show **타이머 없는 테마입니다.**
- **페이즈** — current phase, forced **전환** to any phase (runs leave/enter hooks, confirmed), and **재시작** (re-fires the current phase's leave + enter hooks). A restart also clears the phase's **1회만 실행** records and **aborts the phase's in-flight event runs** — including runs blocked on a device ack (e.g. a device that died mid-sequence) — so the phase re-enters from a clean slate; the aborted run never executes its remaining commands.
- **수동 이벤트** — one button per event with **수동 실행 허용**, grouped **현재 페이즈** / **공통** / **다른 페이즈** (out-of-phase buttons are disabled).
- **힌트 전송** — pick a hint (`{코드} · {이름}`) and a step, **전송** pushes it to the hint device — the operator-side override of the code-entry flow. Warns if no device is flagged 힌트 장치.
- **디바이스** — per-device **온라인**/**오프라인** status (with a **힌트** badge on hint devices) and **모든 디바이스 초기화** (bulk reset, confirmed). Under each device, everything currently playing on it is listed — the current website plus BGM / SFX / dialogue / video — each with a ✕ force-stop button. Stopping media sends the channel's stop command, so the device acks the playback as finished: a sequence waiting on **끝날 때까지 대기** continues as if it ended normally. Stopping the website resets that device (there is no narrower "close website" wire).
- **실행 중 이벤트** — live view of in-flight sequences: event name, `current/total` command position and the running command's name. Each run has a ✕ button that force-terminates it: a pending device ack or 대기 is broken immediately and the run's remaining commands never execute (same mechanism as a phase restart abort).
- **테스트 코드** (test sessions only) — the issued codes with **코드 복사**.
- **로그** — the live session log (kinds: 세션/페이즈/타이머/트리거/이벤트/커맨드/eval/디바이스/힌트), also queryable after the fact via the REST API. The panel's bottom row is a command input — the operation console (§5.5).
- **세션 결과** (ended sessions only) — the post-game summary: the verdict banner (**테마 종료 — 판정: 성공/실패**), total play time, remaining/overtime, hint usage (including operator pushes), pause count, a per-phase duration chart (**페이즈별 소요 시간**), the hint history (**힌트 사용 내역**), and operator interventions (**운영 개입** — phase restarts, timer adjustments). Also available via `GET /api/sessions/:id/summary`.

Toasts from the **알림 보내기** command appear on this screen. A 테마 종료 command ends the session on its own (no operator action needed); the verdict then appears in the **세션 결과** card.

### 5.3 Running devices with the Player app

The Player (RoomKit Player) always opens its **launcher** window first:

- **서버 URL** — the server origin (e.g. `http://localhost:3000`). Saved automatically (all settings persist to `config.json` in the app data dir — macOS: `~/Library/Application Support/app.roomkit.player/`).
- **플레이어 이름** — how this machine appears in Studio's **연결된 플레이어** tab, with a live connection indicator (**서버에 연결됨** / **연결 중…** / **오프라인**). A default name (`플레이어-XXXX`) and a stable player id are generated on first run. When Studio starts a test session (or a 웹 테스트, §6.5) targeting this player, device windows open automatically.
- **디바이스** list — **추가** a row per device: **라벨**, **디바이스 코드** (production code or test code), **키오스크** checkbox. **열기** opens that device's stage window; **모두 열기** opens all.

Each device runs in its own **stage window**, so several devices can run on one machine for testing. Stage windows:

- Connect with retry-on-fatal: an `invalid_code` or `session_ended` doesn't stop the client — it re-polls every 5 s, so room devices can be powered on before the session (or their test code) exists and attach on their own.
- Pre-cache media: on every connect the device fetches its asset manifest and downloads files to a local cache (`<app data>/cache/`; file keys are immutable so presence = fresh; files no longer in the manifest are pruned). Cache misses stream the presigned URL and backfill in the background.
- Play audio (dialogue/BGM/SFX mixed simultaneously), video (fullscreen or at the asset's placement rect), the subtitle overlay, the hint-code overlay, and websites in an embedded iframe. A website embedded via the helper can claim subtitle / hint-code / video rendering for itself (§6.3) — the Player then suppresses its own overlay for the claimed slots.
- Show a connection badge only while *not* connected — production rooms see no chrome.

**Test mode** activates automatically when the session is a test session. A top status bar shows a **TEST** tag, device name, session state (**대기**/**진행 중**/**일시정지**/**종료**), the timer, the verdict (**판정: 성공/실패**), cache sync progress, and connection status (collapsible). It adds:

- A **트리거** row — type an event name (e.g. `door-open`) and **전송** to simulate a sensor/button; recent triggers become reusable chips.
- Skip buttons for waited playback: **대사 건너뛰기 ⏭** and **영상 건너뛰기 ⏭** — stops the media and acks the command, so `끝날 때까지 대기` sequences advance immediately. Placeholder simulations are skippable too.

**Kiosk mode** (the **키오스크** checkbox) is for production room devices: fullscreen, always-on-top, close prevention, and browser-shortcut suppression (F5/F11/F12, Ctrl+R/W/P/F, devtools chords). Escape chord: **Ctrl+Shift+Alt+F12** → confirm **키오스크 잠금을 해제할까요?**. Independent of the kiosk flag, production stage windows also suppress the context menu and hide the cursor while a video plays. OS-level chords (Win key, Alt+Tab) cannot be blocked from an app — use Windows Assigned Access for a hard lock.

### 5.4 A minimal test loop

1. Author a couple of placeholder media assets, a 플레이어, one phase, and a 세션 시작 event that plays BGM.
2. Start the Player app, set the server URL, note the 플레이어 이름.
3. In 운영: **테스트 세션 만들기** → **연결된 플레이어** → pick the player → **만들기**. Stage windows open by themselves.
4. **세션 시작**. Watch the log panel and the stage windows; use the test overlay's 트리거 input to fire device-trigger events and skip buttons to fast-forward.

### 5.5 The operation console

The input row at the bottom of the log panel runs one-off commands against the selected session — every command from the editor palette (§4.4) plus local lookups, without authoring an event. Type `help` for the full syntax; ↑/↓ recall history. Local output (help, lists, errors) is interleaved into the log stream; session commands report through the server log like any sequence command.

Rules:

- Assets are referenced **by name** (or id). Partial names match when unambiguous; quote names containing spaces (`"메인 테마"`).
- Where a play command takes a player and the theme has exactly one 플레이어 asset, it can be omitted.
- Durations accept `1.5s`, `500ms`, `2m`; a bare number means seconds.
- Commands run even while the session is paused or not yet started (operator override — a sequence would wait at the pause gate instead).

| Input | Runs |
|---|---|
| `help` | Print the command reference. |
| `list devices\|players\|events\|phases\|hints\|bgm\|sfx\|video\|dialogues\|websites\|messages\|assets` | Local listing with per-kind detail — devices show online status, events show their trigger/phase, hints show code and step count. |
| `playBgm <bgm> [<player>] [once] [wait]` | BGM 재생 — loops by default; `once` disables looping, `wait` sets 끝날 때까지 대기. |
| `playSfx <sfx> [<player>] [wait]` · `playVideo <video> [<player>] [wait]` · `playDialogue <dialogue> [<player>] [wait]` | The corresponding play command. |
| `stopBgm` / `stopSfx` / `stopVideo` / `stopDialogue` `[<player>\|all]` | Stop the channel — on every player when the player is omitted or `all`. |
| `navigate <device> <website> [key=value ...]` | 웹사이트 이동 with optional query params. |
| `sendMessage <device> <message> [{"key":"value"}]` | 메시지 전송 — the trailing JSON object supplies the field values. |
| `sendWebsiteRequest <website> <method> <path> [wait] [body=<text>] [header=Name:Value ...]` | 웹사이트에 요청 전송. Quote options that contain spaces. |
| `resetDevice <device>` · `resetAllDevices` | Device reset. |
| `showHintCode <hint> <device>` · `hideHintCode [<device>\|all]` | Hint-code overlay. |
| `switchPhase <phase>` · `callEvent <event> [wait]` | Phase switch / run an event's sequence. |
| `wait <duration>` | Server-side wait (rarely useful standalone). |
| `adjustTimer +30s\|-1m\|pause\|resume` | Timer adjustment. |
| `endTheme success\|fail` | Game over with the given verdict. |
| `notify <message>` | Toast on the operation screen. |
| `eval <code>` | Run code in the eval sandbox (§4.5); everything after `eval` is passed verbatim. |

Examples:

```
list devices
playBgm 오프닝              # single-player theme: player omitted
playSfx 효과음A 메인플레이어
navigate 태블릿 안내페이지 mode=dark
callEvent "문 열림 연출" wait
adjustTimer +5m
eval ctx.vars.keys = 3; ctx.notify('열쇠 지급됨')
```

---

## 6. Building a Website with the Helper Script

Websites shown *inside the Player's iframe* (via the **웹사이트 이동** command) embed `@roomkit/helper`. The helper never opens its own connection — all traffic rides the Player's existing device connection over `postMessage`. This section is the tour; the full API and protocol reference is [HELPER.md](./HELPER.md).

> If your site runs standalone (a regular browser, its own machine), it is a device in its own right: register a 장치 asset for it and use `@roomkit/client` (§7) instead. The helper is inert outside the Player — its messages go nowhere, silently.

### 6.1 Embedding

Build the package (`pnpm --filter @roomkit/helper build`) and copy `packages/helper/dist/roomkit-helper.global.js` into your site (it's a self-contained ~5 KB IIFE that defines `window.RoomKitHelper`):

```html
<script src="./roomkit-helper.global.js"></script>
<script>
  const rk = new RoomKitHelper();
</script>
```

On construction the helper posts a `hello` to the parent; the Player buffers any outbound messages until then, so you never miss a message by loading late.

The constructor also applies the Player's kiosk defaults inside the iframe: the context menu and text selection are disabled document-wide (`input`/`textarea` stay selectable). In a test session the context menu stays available (for devtools); the Player reports the session mode to the helper, exposed as `rk.sessionMode` (`'production'` / `'test'`). Pass `new RoomKitHelper({ lockdown: false })` to skip the lockdown entirely while developing the site in a normal browser; `destroy()` reverts it.

### 6.2 API

```js
const rk = new RoomKitHelper();

// report a game event — fires 장치 트리거 events whose 트리거 이름 matches
rk.trigger('door-open');
rk.trigger('keypad', { digits: '0417' });          // optional JSON payload

// same, but resolves once every event run the trigger started has fully
// finished on the server (rejects on timeout — default 10 min — or offline)
await rk.triggerAndWait('door-open');

// receive 메시지 전송 payloads (values keyed by the message asset's field keys)
rk.on('message', (payload, envelope) => {
  if (envelope.messageName === 'set-lamp') lamp.toggle(payload.on);
});

// hint UI (when this device is the 힌트 장치)
rk.submitHint('0417');                             // code the team typed
rk.requestHintStep(hintId, 1);                     // reveal the next step (0-based)
rk.on('hint', (hint) => {
  // { hintId, code, step, stepCount, textHtml, imageUrl }
  render(hint.textHtml, hint.imageUrl);
});
rk.on('hintError', (err) => {
  // err.reason: 'unknown_code' | 'unknown_hint' | 'invalid_step'
  //           | 'not_hint_device' | 'session_not_running'
});

// remaining countdown ms via the Player (null = theme has no timer;
// frozen while paused, 0 when expired). Rejects after timeoutMs (default
// 10 s) when no Player answers — e.g. the site runs outside the Player.
const ms = await rk.getRemainingTime();
await rk.getRemainingTime({ resync: true }); // re-sync with the server first

// 'production' | 'test' — the session mode the Player reported (defaults to
// 'production' until told otherwise)
rk.sessionMode;

rk.destroy();   // remove listeners; the instance is dead afterwards
```

`on`/`off` are chainable, and the `triggerAndWait`/`getRemainingTime` timeouts are tunable (`rk.triggerAndWait('x', payload, { timeoutMs })`, `rk.getRemainingTime({ timeoutMs })`). By default that is the entire surface — playback, navigation, and reset are handled by the Player around your iframe; the site only deals with triggers, messages, and hints. To take over on-screen rendering too, claim slots as below.

### 6.3 Rendering subtitles, hint codes, or video in the site

Pass `renders` to claim slots — each independently:

```js
const rk = new RoomKitHelper({
  renders: { subtitle: true, hintCode: true, video: false },
});
```

For every claimed slot the Player stops rendering its own overlay and forwards the data instead. Each payload carries the same authoring inputs the default overlay uses — the CSS (자막 CSS / 힌트 코드 CSS) and the asset's **파라미터 (JSON)** — so the site decides how (or whether) to apply them:

```js
// claimed subtitle slot — fired per line; null clears the subtitle
rk.on('subtitle', (s) => {
  // s: { html, css, params, lineIndex, lineCount } | null
  subtitleEl.innerHTML = s ? s.html : '';
});

// claimed hintCode slot — null hides the code
rk.on('hintCode', (h) => {
  // h: { code, css, params } | null
  codeEl.textContent = h ? h.code : '';
});

// claimed video slot — the site plays the media itself, audio included
rk.on('videoPlay', (v) => {
  // v: { commandId, assetName, url, durationMs, frame, params }
  video.src = v.url;                        // media URL (see note below)
  video.onended = () => rk.videoEnded(v.commandId);
  video.onerror = () => rk.videoError(v.commandId);
  video.play();
});
rk.on('videoStop', ({ commandId }) => video.pause());
```

Notes:

- **Claiming `video` is a contract**: the Player renders no video element at all, and the **비디오 재생** command's ack waits for your `videoEnded(commandId)` (or `videoError`). Forgetting it stalls every `끝날 때까지 대기` sequence on that video — the test overlay's skip button is the escape hatch. Placeholder (fileless) videos are the exception: `url` is `null`, the Player acks on its own `durationMs` timer, and the site may just render a placeholder.
- `url` is served from the Player's local media cache when the file is cached (a loopback HTTP server on `127.0.0.1`, reachable from cross-origin iframes), falling back to the time-limited presigned URL otherwise — just assign it to `video.src` either way.
- Claims are declared in the `hello` and **reset on navigation**: each page re-claims in its own constructor, and a page without claims restores the Player's default rendering.
- On claiming, the current state is delivered immediately (e.g. a subtitle already on screen), so a late-loading page doesn't miss it.
- `css`/`params` are forwarded verbatim (trusted admin input, like subtitle HTML). `params` is the free-form **파라미터 (JSON)** field on the 대사/힌트/비디오 asset — use it for per-asset options your renderer understands (speaker names, layouts, effects).

### 6.4 Registering the site

Create a 웹사이트 asset (§4.1):

- **외부 URL** — the site is hosted elsewhere; RoomKit just navigates to the URL.
- **ZIP 호스팅** — upload a static build (zip with `index.html` at root, ≤ 500 MiB). The server extracts it to S3 and serves it at `/api/sites/{assetId}/` (public route — the unguessable asset id is the only capability; don't put secrets in game sites). Re-uploading swaps the content atomically.

Then point a **웹사이트 이동** command at it. The device acks after the page loads, so a following command (say, 대사 재생 introducing the puzzle) starts only once the site is visible.

### 6.5 Iterating on a site: the 웹 테스트 workspace

The **웹 테스트** workspace (fourth sidebar menu item) exercises a website + helper integration without creating a session — nothing is saved, and the site's triggers are *reported, never executed*, so you can bang on a puzzle page without game logic firing.

Setup: pick a connected **플레이어** and one of the theme's **장치** assets, enter any **웹사이트 URL** — a dev server like `localhost:5173` works, with HMR intact — or pick from the theme's website assets (**웹사이트 애셋에서 가져오기…**), then **테스트 시작**. The Player opens a dedicated stage window for the test; **장치 접속 코드 복사** copies the run's device code so any other client (a real device, `@roomkit/client`) can join instead. The run screen:

- **Header** — the URL field with **이동** (re-point the window live), **사이트 새로고침**, a **시뮬레이션 페이즈** picker (used only for trigger-match display), and **종료**.
- **수동 커맨드** — pick any command from the palette and **실행** it against the test device immediately. Device/player targets are pinned to the test device; commands that need a real session (웹사이트 이동, 대기, 페이즈 전환, 이벤트 호출, 테마 종료, 타이머 조정, JavaScript 실행, 알림 보내기) are excluded.
- **이벤트 실행** — run a whole event's sequence; commands targeting other devices and flow commands are skipped and logged.
- **타이머** — a simulated countdown (**타이머 설정 (분)**, pause/resume, adjust freely): the site's `getRemainingTime()` reads this value.
- **활동 로그** — everything the site does: triggers (with the events they *would* match under the simulated phase — a matched event has a shortcut to run it), hint submissions, command acks.

Runs are in-memory: a server restart clears them, and stale runs are swept after 12 hours.

---

## 7. Using @roomkit/client Directly

`@roomkit/client` is how any custom device — a Raspberry Pi prop controller, a standalone kiosk website, a mobile app — connects to the server without the Player. It's a workspace package (`workspace:*` dependency, ESM + CJS); the Player itself is built on it, so its handling is the reference implementation. This section is the tour; the full reference (per-channel playback contracts, line cues, dedupe/ack semantics) is [CLIENT.md](./CLIENT.md).

### 7.1 Connecting

```ts
import { RoomKitClient } from '@roomkit/client';

const rk = new RoomKitClient({
  serverUrl: 'http://localhost:3000',
  deviceCode: 'lab-door',        // production 장치 코드, or an operator-issued test code
  deviceName: 'door-controller', // optional label for logs
  retryOnFatalError: true,       // keep polling through invalid_code / session_ended
});
rk.connect();
rk.on('status', (status, detail) => console.log(status, detail ?? ''));
rk.on('welcome', ({ device, session }) => console.log('attached as', device.name));
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `serverUrl` | — | Server origin (http/https). |
| `deviceCode` | — | Production device 코드 or test code. |
| `deviceName` | — | Optional handshake label. |
| `persistTestCode` | `true` | After a successful test attach, remember the code in storage (keyed per server origin) and prefer it on the next `connect()` — auto-rejoin. Set `false` when several clients share one origin's localStorage (the Player does this for its windows). |
| `storage` | `localStorage` | Any `getItem/setItem/removeItem` store; no-op in Node. |
| `retryOnFatalError` | `false` | `invalid_code` / `session_ended` normally stop the client with status `error`. With this on, it forgets any stored test code and re-polls with the configured code every `fatalRetryDelayMs` — so devices can boot before their session/code exists. |
| `fatalRetryDelayMs` | `5000` | Delay between fatal-error retries. |
| `debug` | `false` | Log the connection lifecycle, inbound events/commands, and outbound emits to the console (prefixed `[roomkit]`). |

Connection lifecycle surfaces solely through the `status` event and the `rk.status` getter: `idle → connecting → connected / disconnected / error` (`detail` carries the connect-error reason). `rk.sessionState` holds the last session snapshot.

### 7.2 Handling commands

Playback and navigation are *callbacks with an ack*: the server sequence may be blocked on your `done()`, so call it when the action truly finished. `done()` is idempotent and redeliveries are deduped by command id, so you can't double-ack.

```ts
// playback — the library does not play media; you do
rk.on('play', (cmd, done) => {
  // cmd.channel: 'bgm' | 'sfx' | 'dialogue' | 'video'
  // media fields: fileKey/url (null for placeholders) + durationMs (placeholders)
  if (cmd.url === null) return setTimeout(done, cmd.durationMs); // placeholder
  const audio = new Audio(cmd.url);
  audio.onended = () => done();          // resolves 끝날 때까지 대기
  audio.onerror = () => done('failed');
  audio.play();
});
rk.on('stop', (cmd) => stopChannel(cmd.channel, cmd.playerId)); // playerId null = all

// navigation — ack once the site actually changed; for window-level navigation,
// call done() BEFORE changing location (the page is about to unload)
rk.on('navigate', (url, cmd, done) => { done(); location.href = url; });

// structured payloads from 메시지 전송
rk.on('message', (payload, cmd) => applyMessage(cmd.messageName, payload));

// 장치 리셋 / 모든 장치 리셋
rk.on('reset', () => resetToInitialState());

// session state (phase, pause, timer) — tick the countdown locally while
// timerState === 'running', using timerRemainingMs as the anchor
rk.on('sessionState', (s) => updateUi(s.state, s.phaseId, s.timerRemainingMs));
```

For dialogue on a split speaker/screen pair: the speaker calls `rk.sendProgress(cmd.id, lineIndex)` as each line starts; the screen role receives it via `rk.on('progress', …)` to switch subtitles in sync. (A single client with `role: 'both'` handles both sides itself.)

### 7.3 Triggers, hints, and pre-caching

```ts
// wire a sensor/button to a 장치 트리거 event
gpio.on('pressed', () => rk.trigger('door-open'));

// awaited variant — resolves once every event run the trigger started has
// fully finished on the server (rejects on timeout, default 10 min)
await rk.triggerAndWait('door-open');

// hint UI — only meaningful on the 힌트 장치
rk.submitHint('0417');
rk.requestHintStep(hintId, step + 1);
rk.on('hint', (hint) => renderHint(hint));
rk.on('hintError', (err) => flashError(err.reason));
rk.on('hintCode', (cmd) => cmd.code ? showCodeOverlay(cmd.code, cmd.css) : hideCodeOverlay());

// remaining countdown ms, ticked locally from the last session-state
// snapshot (null = theme has no timer; frozen while paused, 0 when expired).
// resync asks the server for a fresh snapshot first (best effort — falls
// back to the local value when disconnected or on timeout).
const ms = await rk.getRemainingTime();
await rk.getRemainingTime({ resync: true }); // timeoutMs tunes the round-trip cap (default 10 s)

// media manifest for pre-caching (presigned URLs, ~6h — re-call to refresh)
const manifest = await rk.fetchAssetManifest();
for (const entry of manifest.entries) await download(entry.fileKey, entry.url);

rk.disconnect();
```

A device's manifest contains only what it should pre-cache: speaker devices get BGM/SFX/dialogue lines, screen devices get video. Placeholders are excluded.

---

## 8. Reference

### 8.1 REST API

All routes under `/api`, JWT Bearer auth except where marked public. Log in with `POST /api/auth/login` `{ id, password }` → `{ accessToken }`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/login` (public), `GET /auth/me` |
| Health | `GET /health` (public) |
| Themes | `GET/POST /themes`, `GET/PATCH/DELETE /themes/:id`, `POST /themes/:id/duplicate`, `GET /themes/:id/export` (zip), `POST /themes/import` (zip) |
| Assets | `GET/POST /themes/:themeId/assets` (query `kind`, `tagId`), `GET/PATCH/DELETE /themes/:themeId/assets/:id` |
| Tags | `GET/POST /themes/:themeId/tags`, `PATCH/DELETE /themes/:themeId/tags/:id` |
| Uploads | `POST /themes/:themeId/uploads` (presign PUT → `{ key, url }`), `GET /files/url?key=` (presign GET) |
| Zip imports | `POST /themes/:themeId/imports/:kind` (bgm/sfx/dialogue/video), `POST /themes/:themeId/imports/site` |
| Hosted sites | `GET /sites/:assetId` and `GET /sites/:assetId/*` (public) |
| Media | `GET /media/:assetId` (public — 이미지/파일 assets, §4.1) |
| Sessions | `GET/POST /sessions`, `GET/DELETE /sessions/:id`, `POST /sessions/:id/start·pause·resume·end·timer·phase·phase/restart·trigger·reset-devices·hint`, `POST /sessions/:id/command` (one-off operator command — a §4.4 command JSON, fire-and-forget; the console's backend), `GET /sessions/:id/runs` (in-flight event runs), `POST /sessions/:id/runs/:runId/abort` (force-terminate an in-flight event run), `GET /sessions/:id/summary` (post-game summary; 409 until ended) |
| Logs | `GET /sessions/:id/logs` |
| Website tests | `GET/POST /website-test`, `GET/PATCH/DELETE /website-test/:runId`, `GET /website-test/:runId/activity`, `POST /website-test/:runId/command·run-event·cancel-run·reload·timer` (§6.5) |

Session *control* is REST; the `/admin` socket namespace is broadcast-only (session state, logs, device/player status, running events, playing media, notifications, website-test state/activity). The `/player` namespace registers Player apps (the **연결된 플레이어** list) and pushes window-open commands to them: `test:start` for test sessions, `websiteTest:start`/`websiteTest:stop` for website tests.

### 8.2 Device wire protocol (socket.io `/device`)

Connect with `auth: { deviceCode, deviceName? }`. Server→client: `welcome`, `command`, `session:state`, `hint:show`, `hint:error`, `progress`. Client→server: `ack { commandId, status: done|failed }`, `trigger { event, payload? }` (optional socket.io ack, answered once the event runs it started have finished), `progress { commandId, lineIndex }`, `hint:submit { code }`, `hint:next { hintId, step }`, `assets:manifest` (ack-style request → manifest), and `session:sync` (ack-style request → fresh session-state snapshot; backs `getRemainingTime({ resync: true })`). Wire command types: `play` (channel bgm/sfx/dialogue/video), `stop`, `navigate`, `reset`, `message`, `hintCode`. Fatal connect errors: `invalid_code`, `session_ended`. All schemas live in `packages/shared/src` (`protocol.ts`, `wire.ts`, `commands.ts`, `helper.ts`).

### 8.3 Troubleshooting

- **Login fails on host dev** — `ADMIN_PASSWORD_HASH` unset or not a bcrypt hash; regenerate with the one-liner in §2.2. The `admin`/`roomkit` default only applies to the docker-compose stack.
- **Presigned upload/playback URLs unreachable from devices** — set `S3_PUBLIC_ENDPOINT` to the endpoint clients can reach; signatures are bound to the host, so the internal endpoint won't work from outside.
- **웹사이트 이동 opens localhost on a room device** — set `PUBLIC_SERVER_URL` to the origin devices can reach.
- **Server change not taking effect under `pnpm infra`** — the docker image is stale; restart `./compose.sh` to rebuild.
- **Shared schema change not visible** — rebuild `@roomkit/shared` (server consumes `dist`); make additive fields `.default()`/`.optional()`.
- **Two Player windows attach as the same device** — expected if you rolled your own client with `persistTestCode` left on while sharing one origin; the Player sets `persistTestCode: false` and takes codes from the launcher config.
- **Device shows 오프라인 but is running** — check its 코드 matches the 장치 asset (production) or the issued test code; watch the stage window's connection badge for the `connect_error` reason.
- **E2E tests** — `pnpm test:e2e` (uses the `roomkit_test` database created by the compose init script).
