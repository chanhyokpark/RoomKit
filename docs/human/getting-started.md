# 설치하고 실행하기

[문서 홈](../TOC.md) · [이전: RoomKit 이해하기](./overview.md) · [다음: Player 설정하기](./player.md)

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

인프라만 Docker로 실행하고 Server와 Studio를 호스트에서 실행하실 수 있습니다. 처음 한 번은 Server 환경 파일을 만들고 데이터베이스 마이그레이션을 적용해 주세요.

```sh
docker compose up -d
./init.sh
pnpm --filter server exec prisma migrate deploy
pnpm dev:server
```

`./init.sh`는 관리자 비밀번호를 물어보고 무작위 JWT secret과 bcrypt 비밀번호 해시가 포함된 `apps/server/.env`를 만듭니다. 비대화식 환경에서는 `./init.sh 원하는-비밀번호`를 사용할 수 있습니다. 이미 파일이 있으면 덮어쓰지 않으며, 의도적으로 다시 만들 때만 `--force`를 사용해 주세요.

Studio는 별도 터미널에서 실행해 주세요.

```sh
cp -n apps/studio/.env.example apps/studio/.env
pnpm --filter studio dev
```

기본 `PUBLIC_API_URL`은 `http://localhost:3000`입니다. 다른 컴퓨터에서 Studio나 Player를 열 때는 브라우저와 장치가 실제로 접근할 수 있는 주소로 바꿔 주세요.

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

한 컴퓨터에서 여러 장치를 실행할 때는 런처가 장치별 스테이지 창을 열어 줍니다. 설정과 캐시는 앱 데이터 디렉터리에 저장됩니다. 데스크톱 런처의 **테스트** 탭에서는 관리자 계정으로 로그인해 Studio 없이 바로 테스트 세션을 시작할 수도 있습니다.

캐시, 테스트 바, 키오스크 잠금과 Android의 단일 창 제한은 [Player 설정하기](./player.md)를 참고해 주세요.

## 배포 개요

프로덕션은 `docker-compose.yml` 또는 `k8s/` 예제를 기준으로 Server, Studio, PostgreSQL과 S3 호환 스토리지를 배포해 주세요. 외부에 공개할 때는 다음을 반드시 확인해 주세요.

- 기본 관리자 비밀번호를 변경해 주세요.
- Server와 Studio를 HTTPS로 제공해 주세요.
- PostgreSQL과 S3/MinIO를 공개 인터넷에 직접 노출하지 마세요.
- Player와 커스텀 웹 장치에서 접근할 수 있는 서버 URL을 사용해 주세요.
- 프록시가 Socket.io WebSocket 업그레이드를 전달하도록 설정해 주세요.

Kubernetes 예시는 [`k8s/README.md`](../../k8s/README.md)를 참고해 주세요.
