<script lang="ts">
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { useSessionUi } from './context.js';

	const { model } = useSessionUi();
	const notifications = $derived(model.notifications);
	const latest = $derived(notifications[0] ?? null);
	let open = $state(false);

	$effect(() => {
		if (latest) open = true;
	});
</script>

{#if latest}
	<AlertDialog.Root bind:open>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Media><BellRingIcon /></AlertDialog.Media>
				<AlertDialog.Title class="flex flex-wrap items-center gap-2">
					<Badge>운영 알림</Badge>
					<span>{latest.message}</span>
				</AlertDialog.Title>
				<AlertDialog.Description>명령으로 전송된 알림입니다.</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action>확인</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
