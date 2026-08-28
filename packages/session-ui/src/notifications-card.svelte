<script lang="ts">
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { useSessionUi } from './context.js';

	const { model } = useSessionUi();
	const notifications = $derived(model.notifications);
</script>

{#if notifications.length > 0}
	{@const latest = notifications[0]}
	<div class="sticky top-0">
		<Alert.Root>
			<BellRingIcon />
			<Alert.Title class="flex flex-wrap items-center gap-2">
				<Badge>운영 알림</Badge>
				<span>{latest.message}</span>
			</Alert.Title>
			<Alert.Description>
				<p>명령으로 전송된 알림입니다.</p>
				{#if notifications.length > 1}
					<ul class="mt-2 flex flex-col gap-1">
						{#each notifications.slice(1) as notification, index (`${notification.message}:${index}`)}
							<li>이전: {notification.message}</li>
						{/each}
					</ul>
				{/if}
			</Alert.Description>
		</Alert.Root>
	</div>
{/if}
