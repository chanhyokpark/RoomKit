# 힌트폰 만들기

[문서 홈](../TOC.md) · [React 예제](../../templates/hintphone/README.md)

`@roomkit/hintphone-react`와 `@roomkit/hintphone-svelte`는 코드 입력, 단계 이동, 정답 표시와 사용 통계를 제공하는 headless 컴포넌트 라이브러리입니다. 스타일은 프로젝트에서 직접 적용해 주세요.

## React 설정

```yaml
onlyBuiltDependencies:
  - "@roomkit/hintphone-react"
```

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/hintphone-react"
```

```tsx
import { HintInput, HintphoneProvider, HintRenderer } from '@roomkit/hintphone-react';

export function App() {
  return (
    <HintphoneProvider options={{ mode: 'helper' }}>
      <HintInput variant="keypad" maxLength={4} />
      <HintRenderer empty={<p>힌트 코드를 입력해 주세요.</p>} />
    </HintphoneProvider>
  );
}
```

`mode: 'helper'`는 Player 안의 웹사이트에 사용해 주세요. 독립 실행형 힌트폰은 `mode: 'client'`, `serverUrl`과 선택적인 `deviceCode`를 설정해 주세요. 기본 `auto` 모드는 iframe이면 Helper, 아니면 Client를 선택합니다.

## 서버 설정

1. 힌트폰에 사용할 장치에서 **힌트 장치**를 켜 주세요.
2. 코드와 단계, 선택적인 정답을 가진 힌트 애셋을 만들어 주세요.
3. 웹사이트 애셋에 힌트폰 빌드 결과나 외부 URL을 등록해 주세요.
4. 테스트 세션 또는 웹 테스트에서 코드를 입력해 주세요.

`HintRenderer`는 관리자 입력인 힌트 HTML을 렌더링합니다. 신뢰할 수 없는 사용자가 힌트 내용을 작성할 수 있는 환경이라면 서버에서 별도 정제가 필요합니다.

`useHintCounter()`는 공개한 고유 힌트 수, 단계 수, 정답 수와 잘못 입력한 코드 수를 제공합니다. 운영 UI나 세션 통계와는 별도로 현재 브라우저 실행 중의 사용량을 표시할 때 사용해 주세요.
