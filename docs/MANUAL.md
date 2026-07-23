# RoomKit — User Manual

How to run RoomKit and use its UIs: the **Studio** (authoring + operation web app) and the **Player** (device app). System concepts and terms are covered in [INTRO.md](./INTRO.md) — read that first if terms like *theme*, *event*, *player asset*, or *test session* are unfamiliar.

The Studio and Player UIs are in Korean; this manual quotes button labels verbatim.

## 1. Getting Started

### 1.1 Run the infrastructure

Development infra (Postgres on port 5433, MinIO on 9000/9001 with a `roomkit` bucket) is provided by docker compose:

```sh
pnpm infra          # or ./compose.sh — foreground, Ctrl+C to stop
```

### 1.2 Configure and run the server

Copy `apps/server/.env.example` to `apps/server/.env` and fill in:

- `DATABASE_URL` — Postgres connection string (compose default: port 5433, user/pass/db `roomkit`)
- `JWT_SECRET` — any string ≥ 16 chars
- `ADMIN_ID`, `ADMIN_PASSWORD_HASH` — the single admin account; the hash is bcrypt (e.g. `node -e "console.log(require('bcryptjs').hashSync('yourpassword'))"`)
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true` — MinIO defaults from compose
- `PUBLIC_SERVER_URL` — the origin devices can reach (defaults to `http://localhost:3000`); used to build hosted-website URLs

Apply migrations, then start:

```sh
pnpm --filter server exec prisma migrate deploy
pnpm dev:server     # builds @roomkit/shared, then nest start --watch on :3000
```

### 1.3 Run the Studio

```sh
pnpm --filter studio dev    # SvelteKit dev server on :5173
```

Set `PUBLIC_API_URL` in the studio env if the server is not at the default origin.

### 1.4 Run the Player (devices)

```sh
pnpm dev:player     # tauri dev (desktop app; frontend on :5175)
pnpm --filter player dev:web   # browser-only harness, no Rust needed
pnpm --filter player build:app # production desktop build
```

## 2. Logging In

Open the Studio → you land on `/login`. Enter the admin **아이디** and **비밀번호** (from the server env) and press **로그인**. The token is kept in the browser; it expires after 12 hours or on any auth failure, which returns you to the login page. **로그아웃** is at the bottom of the sidebar.

## 3. Themes

A theme is one escape room game; everything you author lives inside one. The **theme switcher** is the large button at the top of the sidebar — it shows the current theme and its time limit ("제한 시간 N분" or "타이머 없음").

From the switcher dropdown:

- **새 테마** — create. Fields: **이름** and **제한 시간 (분)** (leave empty for no countdown timer).
- **테마 수정** — rename / change the time limit.
- **테마 복제** — deep copy: all assets are duplicated and every cross-reference (player device refs, event phases, sequence targets) is remapped to the copies. Device/hint codes copy verbatim; media files are shared with the original, not re-uploaded. Use this for running multiple rooms of the same game or keeping a season backup.
- **테마 삭제** — deletes the theme **and all of its assets**, irreversibly (confirmation required).

Below the switcher, the sidebar menu navigates the three workspaces of the current theme: **애셋** (assets), **에디터** (editor), **운영** (operation).

## 4. Asset Management (애셋)

The asset page is a two-pane layout: the asset list on the left, and an edit panel that docks on the right (a bottom sheet on mobile).

### 4.1 Browsing

- **Kind tabs** across the top, grouped: 장치 (**장치**/device, **플레이어**/player) · 미디어 (**BGM**, **효과음**/SFX, **대사**/dialogue, **비디오**/video) · 콘텐츠 (**웹사이트**, **메시지**, **힌트**) · 진행 (**페이즈**, **이벤트**).
- **태그 필터** — narrow the list to one tag. **태그 관리** opens the tag dialog (create with a color + name; rename, recolor, delete inline). Tags are purely organizational.
- Media kinds show as **cards** (BGM/SFX cards have an inline ▶ play button; video cards open a preview dialog). Other kinds show as a **table**. Dialogue rows expand to list their lines, each playable inline.
- Every asset has a **⋯ menu** with **수정** (edit) and **삭제** (delete, confirmed). Clicking a row/card also opens the editor.

### 4.2 Creating and editing assets

**새 {kind}** opens the editor panel. Common fields: **이름** (required), **설명** (optional note), **태그**, and — for devices and hints only — **코드**.

Per kind:

- **장치 (Device)** — **코드** is required: the credential a physical device uses to register in production. **표시 이름** is the friendly label shown in operation screens. The **힌트 장치** switch marks this device as the hint kiosk (it may submit hint codes and receives hint pushes).
- **BGM / 효과음 / 비디오** — upload one file (**파일 선택**; uploads go straight to storage with a progress bar). Save **without a file** to create a *placeholder* asset: set **재생 시간 (ms)** and clients will simulate playback for that duration — useful for wiring sequences before media exists.
- **대사 (Dialogue)** — an ordered list of lines (**라인 추가**, reorder with ↑/↓). Each line: an audio file (or a placeholder duration) and a **자막 (HTML 허용)** subtitle. The **재생 후 자막 유지** switch leaves the last subtitle on screen after playback.
- **힌트 (Hint)** — **코드** auto-generates a 4-digit code if left empty (players type it on the hint device). Steps (**단계 추가**) are revealed one at a time; each has HTML text and an optional image.
- **플레이어 (Player)** — pick the **스피커 장치** (plays dialogue audio) and **스크린 장치** (renders subtitles and video), optionally **자막 CSS** to style subtitles on that screen. Playback commands in the editor target players, not raw devices.
- **웹사이트 (Website)** — **외부 URL** (just a URL) or **ZIP 호스팅** (upload a zip with `index.html` at its root; a single wrapping folder is stripped automatically; the server hosts it at `/api/sites/{assetId}/`). Re-uploading replaces the site. Sites shown inside the player's iframe must embed the helper script (see §8).
- **메시지 (Message)** — define the payload schema only: fields with **키**, type (문자열/숫자/불리언/JSON), **라벨**, **필수 값**. Actual values are entered later, when authoring a 메시지 전송 command in the editor.
- **페이즈 (Phase)** — just a name and **순서** (lower = earlier). Usually managed from the editor's phase dialog instead.
- **이벤트 (Event)** — trigger settings (see §5.2). The sequence itself is edited in the 에디터.

### 4.3 Bulk ZIP upload

For media kinds, the **ZIP 업로드** button imports many files at once: every media file in the zip becomes a new asset named after its filename. For **대사**, files named `name_1.mp3`, `name_2.mp3`, … are grouped into one dialogue named `name` with lines in numeric order (subtitles are filled in afterwards in the editor); files without a suffix become single-line dialogues. Junk entries (`__MACOSX/`, dotfiles, unsupported extensions) are skipped and reported. Filenames inside the zip must be UTF-8.

## 5. Editor (에디터)

The editor is where game logic lives: phases across the top, events on the left, and the selected event's command sequence in the middle.

### 5.1 Phases

Tabs: **공통** (the common workspace — events valid in every phase) plus one tab per phase. **페이즈 관리** opens a dialog to create (**새 페이즈 이름** + **추가**), rename, reorder (↑/↓), and delete phases. Deleting a phase moves its events to 공통.

### 5.2 Events

**새 이벤트** creates an event in the current workspace. Event settings (also editable later via **메타데이터 수정** or the card's ⋯ → 수정):

- **페이즈** — which phase the event belongs to, or 공통 (모든 페이즈).
- **트리거 종류** — how it starts:
  - **장치 트리거** + **트리거 이름**: fires when a device reports that event name (e.g. `door-open` from a sensor).
  - **수동 트리거**: fired from the operation screen.
  - **시스템 트리거** + hook: fired automatically on `session:start`, `phase:enter`, `phase:leave`, or `timer:expired`.
- **수동 실행 허용** — also show this event as a button on the operation dashboard.
- **재진입 허용** — allow triggering while the event is already running (blocked by default).

Only events of the session's current phase (plus 공통) can fire; out-of-phase triggers are ignored and logged. Event cards show a ⚠ warning when a sequence references a deleted asset or has unset parameters. Deleting an event that other events call via 이벤트 호출 warns and lists the callers.

### 5.3 Building sequences

Select an event, then stack commands like iOS Shortcuts:

- Add from the **커맨드 팔레트** on the right (searchable; a dialog on mobile). Groups: **재생** (대사/효과음/비디오/BGM 재생·정지), **장치** (장치 리셋, 모든 장치 리셋, 웹사이트 이동, 메시지 전송), **흐름** (대기, 페이즈 전환, 이벤트 호출, JavaScript 실행, 테마 종료), **타이머** (타이머 조정).
- Reorder by dragging the grip handle, or via the row's ⋯ menu (**위로/아래로/복제/삭제**).
- Parameters are edited inline on each row. Wherever you pick an asset, the last dropdown option **새 {kind} 만들기** creates one inline without leaving the editor.
- Changes **autosave** (the 저장됨/저장 중/저장 실패 indicator sits in the header; 재시도 on failure).

Parameter notes:

- **대사 재생 / 비디오 재생** target a *player* asset and have a **끝날 때까지 대기** switch — the sequence pauses until the device reports playback finished.
- **BGM 재생** has **반복 재생** (loop) — a new BGM replaces the current one — and an optional **페이드 인 (ms)**; **BGM 정지** has a matching **페이드 아웃 (ms)** (0 = immediate).
- **대기** — milliseconds of server-side wait; pauses together with the session.
- **메시지 전송** — pick a device and a message asset; a form for the message's fields appears, and the values you enter here are what gets sent.
- **타이머 조정** — add/subtract time (positive = add) or pause/resume the countdown.
- **JavaScript 실행** — runs in the server sandbox with `ctx.vars`, `ctx.phase`, `ctx.trigger(name)`, `ctx.log(msg)`; **returning `false` stops the sequence**, which is how you build conditions ("only continue if `ctx.vars.solved >= 3`").
- **이벤트 호출** — run another event's sequence inline (reuse).
- **테마 종료** — game over: resets every device and records the **판정** (성공/실패), which appears as a banner on the operation dashboard. The session stays live — the operator ends it manually.

## 6. Operation (운영)

The operation page runs live sessions: session list on the left, dashboard for the selected session on the right. It holds a live connection to the server — a red banner appears if it drops.

### 6.1 Creating sessions

- **프로덕션 세션 만들기** — the real game. Only one live production session may exist per theme (the button disables while one exists). Physical devices with matching device codes attach automatically — including ones already powered on and waiting.
- **테스트 세션 만들기** — a rehearsal. The dialog lists every device in the theme with a **code input** (pre-filled with suggestions; codes must be unique). After creation the codes are shown with copy buttons — hand them to testers, who connect via the player (test mode) or any `@roomkit/client` app. Codes are remembered per theme for next time and freed when the session ends.

Sessions are created **idle** ("시작 전"). Devices can connect while idle, so check the 디바이스 card before starting. Idle and ended sessions can be deleted (trash icon on hover; deletes their logs too).

### 6.2 Running a session

Top-bar controls: **세션 시작** → **일시정지 / 재개** → **세션 종료**.

- **세션 시작** opens a confirmation. If devices are offline you get an amber warning listing them (you may **그래도 시작**). The **시작 전 모든 디바이스 초기화** switch (default on) sends a reset to every device first. Starting arms the countdown and fires `session:start` events, plus `phase:enter` for the initial phase.
- When a **테마 종료** command runs, a verdict banner (성공/실패) appears above the cards and all devices reset; end the session when you're ready.
- **일시정지** freezes the timer, waits, and sequences; **재개** continues.
- **세션 종료** aborts all running sequences and disconnects the session's devices. Ended sessions cannot be restarted — start a new one (this is the team-turnover flow, see §9).

Dashboard cards:

- **타이머** — live countdown, adjust with **-5분 / -1분 / +1분 / +5분**, and pause/resume the timer alone (independent of session pause). Turns red at 0, which fires the `timer:expired` trigger.
- **페이즈** — shows the current phase; pick another and **전환** to force-switch (runs the leave/enter hooks; confirmed). **재시작** re-fires the current phase's leave + enter hooks without changing the phase — useful to reset a room mid-game.
- **실행 중 이벤트** — live list of event sequences currently running, each with its progress (current command index and type).
- **수동 이벤트** — one button per event with 수동 실행 허용, grouped by 현재 페이즈 / 공통 / 다른 페이즈 (other-phase buttons are disabled — that's the phase guard).
- **디바이스** — per-device online/offline status (hint devices carry a **힌트** badge) and a **모든 디바이스 초기화** button.
- **힌트 전송** — push any hint at any step to the hint device(s), regardless of what code the players typed. Works while paused.
- **테스트 코드** — (test sessions only) the issued codes with copy buttons.
- **로그** — the live session log: session/phase/timer/trigger/event/command/eval/device/hint entries, timestamped; entries with data expand via **…**; errors in red. Auto-scrolls; **맨 아래로** re-sticks after scrolling up.

## 7. Player App (devices)

Install/run the player on each device machine (screens, speaker boxes, hint kiosks).

### 7.1 Launcher

The launcher opens on every start. Configure:

- **서버 URL** — the RoomKit server origin.
- **디바이스** list (**추가** to add one): a **라벨** (for you), the **디바이스 코드** (a production device code, or a test code from the operator), and a **키오스크** checkbox.
- **열기** opens that device's stage window; **모두 열기** opens all of them. Several devices can run on one machine — handy for testing.

Settings save automatically to `config.json`.

### 7.2 Stage windows

A stage window is a black fullscreen surface that plays whatever the server commands: mixed BGM/SFX/dialogue audio, video, styled subtitles, and websites (in an embedded iframe). Media is cached locally on first connect, so playback doesn't depend on the network mid-game.

- If the code isn't valid **yet** (session not created / test code not issued), the window quietly retries every 5 s and attaches by itself once the operator creates the session — so room devices can be powered on first, in any order.
- In a **test session**, the window shows a status bar (TEST badge, device name, session state, timer, connection) and **대사 건너뛰기 / 영상 건너뛰기** skip buttons during playback. Production shows nothing but the content.
- Placeholder assets render as labeled overlays (corner chips for audio, a full-screen card for video) and simulate their configured duration.

### 7.3 Kiosk mode

With **키오스크** checked, the stage window goes fullscreen, always-on-top, hides the cursor, and suppresses browser shortcuts and window closing. Escape chord: **Ctrl+Shift+Alt+F12** (asks for confirmation). OS-level shortcuts (Win key, Alt+Tab) cannot be blocked by an app — for a hard lock on Windows room devices, use Windows Assigned Access.

## 8. Hints and Custom Devices

RoomKit ships no hint UI — the hint kiosk screen is game content you build:

1. Flag a device asset as **힌트 장치**.
2. Build the code-entry UI as a website (or any app) and wire it up:
   - Shown **inside the player's iframe** (via a 웹사이트 이동 command): embed the helper script and use `RoomKitHelper` — `submitHint(code)`, `requestHintStep(hintId, step)`, `on('hint', ...)`, `on('hintError', ...)`.
   - Running **standalone** (own browser/kiosk or custom hardware): use `@roomkit/client` with the device's code — same hint API, plus `trigger()`, playback callbacks, and messages.
3. Players type a hint's 4-digit code → step 1 appears; "next" reveals further steps. Every submission is logged and visible live in the operation 로그 panel, and the operator can push hints proactively from the **힌트 전송** card.

The same two integration paths apply to any custom device: sensors and buttons call `trigger('name')` to fire device-trigger events; screens listen for `message` payloads and `navigate`.

## 9. Team Turnover (between groups)

1. **세션 종료** on the current session.
2. **프로덕션 세션 만들기** — devices reattach automatically.
3. Check the **디바이스** card until everything is online.
4. **세션 시작** — leave **시작 전 모든 디바이스 초기화** on so every device returns to its initial state.

## 10. Tips

- **Author before media exists**: create placeholder BGM/video/dialogue assets (no file, just a duration) and replace the files later — sequences, `waitUntilEnd`, and timing all work unchanged.
- **Test sessions are cheap**: run as many as you like alongside authoring; the phase guard, timer, and logs behave exactly like production.
- **Use 공통 sparingly**: common events fire in every phase — prefer phase-scoped events so stray triggers can't fire out of context (the guard logs ignored triggers, check the 로그 panel when "nothing happened").
- **⚠ on an event card** means a command references a deleted asset or has an empty parameter — the runtime skips such commands and logs it.
- **Media updates are safe mid-authoring**: re-uploading a file gives it a new storage key, and players refresh their cache automatically on next connect.
