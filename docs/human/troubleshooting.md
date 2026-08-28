# 문제 해결

[문서 홈](../TOC.md)

## 서버와 Studio

- Studio가 서버에 연결되지 않으면 `http://localhost:3000/api`가 응답하는지와 프록시의 WebSocket 설정을 확인해 주세요.
- 호스트에서 처음 실행할 때 환경변수 오류가 나면 루트에서 `./init.sh`를 실행했는지, 테이블 오류가 나면 `pnpm --filter server exec prisma migrate deploy`를 실행했는지 확인해 주세요.
- 데이터베이스 오류가 발생하면 PostgreSQL이 `5433` 포트에서 실행 중인지 확인해 주세요.
- 업로드가 실패하면 MinIO의 `9000` 포트, 버킷 설정과 Server의 S3 환경변수를 확인해 주세요.
- 공유 타입을 변경한 뒤 컴파일 오류가 발생하면 `pnpm --filter @roomkit/shared build`를 먼저 실행해 주세요.

## 장치 연결

- `invalid_code`는 장치 코드가 없거나 테스트 세션이 종료되었다는 뜻입니다. 코드와 세션 상태를 확인해 주세요.
- 장치가 세션 전에 실행된다면 `retryOnFatalError: true`를 사용해 주세요.
- 같은 브라우저 오리진의 여러 장치가 같은 테스트 코드로 접속하면 `persistTestCode: false`를 사용해 주세요.
- Player가 Studio의 연결된 플레이어 목록에 없으면 Player의 서버 URL과 네트워크 접근을 확인해 주세요.

## 멈춘 시퀀스

- `play`나 `navigate` handler가 `done()`을 호출했는지 확인해 주세요.
- 커스텀 비디오는 `videoEnded()` 또는 `videoError()`를 호출했는지 확인해 주세요.
- 기다리는 메시지 handler가 끝나지 않는 Promise를 반환하지 않는지 확인해 주세요.
- 대사가 특정 라인에서 멈추면 `holdBefore` 라인에 waiting progress를 보낸 뒤 서버의 재개 progress를 처리하는지 확인해 주세요.
- 운영 화면의 **실행 중 이벤트**와 커맨드 로그에서 정확히 어느 단계가 기다리는지 확인해 주세요.

## Helper 웹사이트

- 일반 브라우저에서 Helper만 실행하면 Player가 없으므로 아무 응답도 오지 않습니다. Player 런처의 테스트 탭에서 웹사이트 URL 대체로 테스트 세션을 시작해 주세요.
- Helper 이벤트가 오지 않으면 페이지마다 `new RoomKitHelper()`가 실행되는지 확인해 주세요.
- ZIP 배포 후 JS/CSS가 404이면 Vite `base: './'` 설정과 ZIP 루트의 `index.html`을 확인해 주세요.
- HTTPS 사이트가 HTTP 서버나 미디어 URL을 직접 요청하지 않도록 해 주세요. Player가 전달한 비디오 URL을 그대로 사용해 주세요.

## 미디어와 자막

- `url: null`은 오류가 아니라 플레이스홀더입니다. `durationMs` 동안 시뮬레이션해 주세요.
- 자막이 맞지 않으면 스피커가 라인마다 `sendProgress()`를 보내고 스크린이 `progress`에서 렌더링하는지 확인해 주세요.
- 반복 BGM은 종료되지 않으므로 재생 시작 직후 완료 응답을 보내 주세요.
- 미디어 정지 시 이전 event listener, timer와 object URL을 함께 정리해 주세요.
- Player 캐시 동기화가 실패해도 URL 스트리밍으로 재생되어야 합니다. 둘 다 실패하면 장치가 접근하는 `S3_PUBLIC_ENDPOINT`, 스토리지 CORS와 presigned URL의 호스트를 확인해 주세요.

## 버전 경고

- 운영 화면의 노란 경고는 연결된 Player, Client 또는 Helper가 Studio의 기대 버전보다 낮다는 뜻입니다. 해당 앱/라이브러리를 함께 업데이트해 주세요.
- 배포 환경에서 의도적으로 다른 최소 버전을 사용할 때는 Studio의 `PUBLIC_EXPECTED_PLAYER_VERSION`, `PUBLIC_EXPECTED_CLIENT_VERSION`, `PUBLIC_EXPECTED_HELPER_VERSION`을 설정해 주세요.

문제가 계속되면 세션 로그, 장치 콘솔과 사용 중인 Client/Helper 버전을 함께 확인해 주세요.
