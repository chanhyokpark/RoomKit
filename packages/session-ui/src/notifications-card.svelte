<script lang="ts">
	import BellIcon from '@lucide/svelte/icons/bell';
	import * as Card from '$lib/components/ui/card';
	import { useSessionUi } from './context.js';

	const { model } = useSessionUi();
</script>

{#if model.notifications.length > 0}
	<Card.Root class="md:col-span-2">
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><BellIcon />알림</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="flex flex-col gap-2">
				{#each model.notifications as notification, index (`${notification.message}:${index}`)}
					<li class="rounded-md border p-3 text-sm">{notification.message}</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
{/if}
