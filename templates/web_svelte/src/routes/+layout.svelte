<script lang="ts">
	import '../app.css';
	import { RoomKitSetup } from '@roomkit/helper-svelte';
	import { dev } from '$app/environment';
	import { clearLogs } from '$lib/logs.svelte';

	let { children } = $props();
</script>

<!--
  Helper는 최상위 레이아웃에서 한 번만 초기화하세요. 옵션은 mount 시 한 번만
  읽히며, 페이지를 새로 이동(navigation)하면 선언이 사라집니다.
-->
<RoomKitSetup
	options={{
		// 일반 브라우저에서 개발할 때 우클릭·텍스트 선택을 막지 않습니다.
		lockdown: !dev,
		// ── 메시지 선언 ─────────────────────────────────────────────────
		// 이 사이트가 처리하는 메시지 애셋 이름 목록입니다. Player에 보고되어
		// 테스트 세션의 디버그 창 목록에서 바로 보낼 수 있습니다(전달 자체는
		// 이 목록과 무관합니다). 실제 처리는 각 페이지에서
		// getRoomKit().onMessage(...)로 등록하세요.
		messages: ['announce'],
		// ── 상태 선언 ───────────────────────────────────────────────────
		// 이 사이트가 렌더링하는 상태 애셋 이름 목록입니다. 상태는 서버가
		// 장치별로 기억해 재접속·새로고침 때 다시 보내므로, "지금 어떤 화면인지"는
		// 메시지가 아니라 상태로 표현하세요(메시지는 일시적인 효과용).
		states: ['screen'],
		// 디버그 창에서 인자 없이 실행할 수 있는 테스트 콜백입니다(테스트 세션 전용).
		testCallbacks: {
			'clear-logs': clearLogs
		}
	}}
>
	{@render children()}
</RoomKitSetup>
