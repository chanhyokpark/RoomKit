<script lang="ts">
	import { getRoomKit } from '@roomkit/helper-svelte';
	import { addLog, logs } from '$lib/logs.svelte';

	const rk = getRoomKit();

	// ── 메시지 처리 ──────────────────────────────────────────────────────
	// 이름을 넘기면 해당 메시지만, 핸들러만 넘기면 모든 메시지를 받습니다.
	// waitUntilEnd 메시지는 핸들러가 반환한 Promise가 끝난 뒤에 ack되고,
	// 이 컴포넌트가 사라지면 등록도 자동으로 해제됩니다.
	rk.onMessage((payload, envelope) => {
		addLog(`${envelope.messageName}: ${JSON.stringify(payload)}`);
	});
</script>

<main>
	{#if rk.outsidePlayer}
		<p role="alert">
			⚠️ 이 페이지가 RoomKit Player 밖에서 열렸습니다. Player 런처의 테스트 탭에서 웹사이트 URL
			대체로 실행해 주세요.
		</p>
	{/if}

	<!--
	  ── 페이지 콘텐츠 ────────────────────────────────────────────────
	  아래 디버그 출력을 지우고 여기에 테마 페이지를 만드세요. Tailwind CSS
	  클래스를 바로 사용할 수 있고, 게임 이벤트는
	  rk.trigger('이벤트이름', payload)로 서버에 보고합니다.
	  힌트폰이 필요하면 <HintInput />과 <HintRenderer hint={rk.hint} />를
	  사용하세요.
	-->
	<p>bridge: {rk.bridge}</p>
	<p>sessionMode: {rk.sessionMode}</p>
	<p>remainingMs: {rk.remainingMs ?? '(타이머 없음)'} (자동 갱신)</p>
	<p>hint: {JSON.stringify(rk.hint.data)}</p>

	<p>메시지 로그:</p>
	{#if logs.length === 0}
		<p>아직 받은 메시지가 없습니다. 디버그 창에서 announce를 보내 보세요.</p>
	{:else}
		{#each logs as log (log.id)}
			<p>{log.text}</p>
		{/each}
	{/if}
</main>
