<script lang="ts">
	import type { VideoFrame } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';

	// Video surface placement, percent of the stage. null = fullscreen.
	let { frame = $bindable() }: { frame: VideoFrame | null } = $props();

	function toggleFullscreen(fullscreen: boolean): void {
		frame = fullscreen ? null : { x: 10, y: 10, width: 80, height: 80 };
	}
</script>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="video-fullscreen">전체 화면</Field.FieldLabel>
		<Field.FieldDescription>
			끄면 화면 내 위치와 크기를 퍼센트로 지정합니다 (예: 채팅 UI 옆의 작은 영상).
		</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="video-fullscreen" checked={frame === null} onCheckedChange={toggleFullscreen} />
</Field.Field>

{#if frame !== null}
	<div class="flex items-start gap-4">
		<div class="grid flex-1 grid-cols-2 gap-2">
			<Field.Field>
				<Field.FieldLabel for="video-frame-x">X (%)</Field.FieldLabel>
				<Input id="video-frame-x" type="number" min={0} max={100} bind:value={frame.x} />
			</Field.Field>
			<Field.Field>
				<Field.FieldLabel for="video-frame-y">Y (%)</Field.FieldLabel>
				<Input id="video-frame-y" type="number" min={0} max={100} bind:value={frame.y} />
			</Field.Field>
			<Field.Field>
				<Field.FieldLabel for="video-frame-width">너비 (%)</Field.FieldLabel>
				<Input id="video-frame-width" type="number" min={1} max={100} bind:value={frame.width} />
			</Field.Field>
			<Field.Field>
				<Field.FieldLabel for="video-frame-height">높이 (%)</Field.FieldLabel>
				<Input id="video-frame-height" type="number" min={1} max={100} bind:value={frame.height} />
			</Field.Field>
		</div>
		<!-- 16:9 stage mockup showing where the video lands. -->
		<div class="relative aspect-video w-40 shrink-0 overflow-hidden rounded-sm border bg-black">
			<div
				class="absolute flex items-center justify-center rounded-[1px] bg-neutral-600/80 text-[9px] text-neutral-200"
				style:left="{frame.x}%"
				style:top="{frame.y}%"
				style:width="{frame.width}%"
				style:height="{frame.height}%"
			>
				VIDEO
			</div>
		</div>
	</div>
{/if}
