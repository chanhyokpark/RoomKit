<script lang="ts">
	import { PUBLIC_API_URL } from '$env/static/public';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LinkIcon from '@lucide/svelte/icons/link';
	import { toast } from 'svelte-sonner';
	import { playerTestLink } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';

	/**
	 * "Open in Player" for a test session: a `roomkit-player://` app link that
	 * the Player app on this computer handles by opening the session's device
	 * windows and its debug window. `PUBLIC_API_URL` is the server Player must
	 * talk to; it should be reachable from the machine running Player.
	 */
	let {
		sessionId,
		size = 'sm',
		variant = 'outline'
	}: {
		sessionId: string;
		size?: 'sm' | 'default';
		variant?: 'outline' | 'default' | 'secondary';
	} = $props();

	const link = $derived(playerTestLink(PUBLIC_API_URL, sessionId));

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(link);
			toast.success('앱 링크가 복사되었습니다.');
		} catch {
			toast.error('클립보드에 접근하지 못했습니다.');
		}
	}
</script>

<div class="flex items-center gap-1">
	<Button {size} {variant} href={link} title="이 컴퓨터의 Player 앱에서 장치 창을 엽니다">
		<ExternalLinkIcon />
		Player 앱에서 열기
	</Button>
	<Button {size} variant="ghost" aria-label="앱 링크 복사" title="앱 링크 복사" onclick={copyLink}>
		<LinkIcon />
	</Button>
</div>
