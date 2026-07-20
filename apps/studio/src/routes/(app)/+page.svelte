<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DramaIcon from '@lucide/svelte/icons/drama';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import ThemeFormDialog from '$lib/components/app-sidebar/theme-form-dialog.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';

	let createOpen = $state(false);

	$effect(() => {
		const first = themesStore.themes[0];
		if (first) {
			void goto(resolve('/(app)/themes/[themeId]', { themeId: first.id }), {
				replaceState: true
			});
		}
	});
</script>

<svelte:head><title>RoomKit Studio</title></svelte:head>

{#if themesStore.themes.length === 0}
	<div class="flex flex-1 items-center justify-center p-4">
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon">
					<DramaIcon />
				</Empty.Media>
				<Empty.Title>테마가 없습니다</Empty.Title>
				<Empty.Description>첫 테마를 만들어 애셋 관리를 시작하세요.</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button onclick={() => (createOpen = true)}>
					<PlusIcon data-icon="inline-start" />
					새 테마 만들기
				</Button>
			</Empty.Content>
		</Empty.Root>
	</div>
{/if}

<ThemeFormDialog
	bind:open={createOpen}
	onSaved={(saved) => goto(resolve('/(app)/themes/[themeId]', { themeId: saved.id }))}
/>
