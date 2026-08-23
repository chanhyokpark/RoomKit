# 설치하고 실행하기

[문서 홈](../TOC.md) · [이전: RoomKit 이해하기](./overview.md) · [다음: 테마 제작하기](./authoring.md)

## 준비 사항

- Node.js 22 이상
- pnpm 10.28.2
- Docker와 Docker Compose
- Player를 직접 빌드하실 때만 Rust 1.77.2 이상

저장소를 받은 뒤 루트에서 의존성을 설치해 주세요.

```sh
pnpm install
```

## 가장 빠르게 전체 시스템 실행하기

```sh
pnpm infra
```

이 명령은 PostgreSQL, MinIO, Server와 Studio를 Docker로 실행합니다.

- Studio: `http://localhost:5173`
- Server: `http://localhost:3000`
- 기본 관리자: `admin` / `roomkit`
- MinIO 콘솔: `http://localhost:9001`

브라우저에서 Studio를 열고 로그인해 주세요. 개발용 기본 비밀번호는 공개 환경에서 사용하지 마세요.

## 서버 코드를 개발할 때

인프라만 Docker로 실행하고 서버를 호스트에서 실행하실 수 있습니다.

```sh
docker compose up postgres minio
pnpm dev:server
```

Studio는 별도 터미널에서 실행해 주세요.

```sh
pnpm --filter studio dev
```

공유 스키마를 변경한 뒤에는 `@roomkit/shared`와 이를 사용하는 패키지를 다시 빌드해 주세요.

```sh
pnpm --filter @roomkit/shared build
pnpm build
```

## Player 실행하기

```sh
pnpm dev:player
```

Player 런처에서 다음 값을 설정해 주세요.

1. 서버 URL에 `http://localhost:3000`을 입력해 주세요.
2. Studio에서 구분하기 쉬운 플레이어 이름을 입력해 주세요.
3. 프로덕션 장치는 테마에 등록한 장치 코드를 사용해 주세요.
4. 테스트 세션에서는 Studio가 발급한 테스트 코드를 사용해 주세요.

한 컴퓨터에서 여러 장치를 실행할 때는 런처가 장치별 스테이지 창을 열어 줍니다. 설정과 캐시는 앱 데이터 디렉터리에 저장됩니다.

## 배포 개요

프로덕션은 `docker-compose.yml` 또는 `k8s/` 예제를 기준으로 Server, Studio, PostgreSQL과 S3 호환 스토리지를 배포해 주세요. 외부에 공개할 때는 다음을 반드시 확인해 주세요.

- 기본 관리자 비밀번호를 변경해 주세요.
- Server와 Studio를 HTTPS로 제공해 주세요.
- PostgreSQL과 S3/MinIO를 공개 인터넷에 직접 노출하지 마세요.
- Player와 커스텀 웹 장치에서 접근할 수 있는 서버 URL을 사용해 주세요.
- 프록시가 Socket.io WebSocket 업그레이드를 전달하도록 설정해 주세요.

Kubernetes 예시는 [`k8s/README.md`](../../k8s/README.md)를 참고해 주세요.
