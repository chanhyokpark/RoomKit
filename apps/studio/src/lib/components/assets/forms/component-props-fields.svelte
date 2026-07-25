<script lang="ts">
	import type { JsonValue, MessageField } from '@roomkit/shared';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';

	// Value inputs for a component's params — the standalone sibling of the
	// sequence editor's message-values-fields (no editor-data context here).
	let {
		fields,
		values,
		onchanged = () => {}
	}: {
		fields: MessageField[];
		/** The attachment's props record — mutated in place. */
		values: Record<string, JsonValue>;
		onchanged?: () => void;
	} = $props();

	// JSON fields keep raw text locally so invalid JSON doesn't destroy input.
	let jsonDrafts = $state<Record<string, string>>({});
	let jsonErrors = $state<Record<string, boolean>>({});

	function jsonText(key: string): string {
		if (key in jsonDrafts) return jsonDrafts[key];
		return values[key] === undefined ? '' : JSON.stringify(values[key], null, 2);
	}

	function commitJson(key: string, text: string): void {
		jsonDrafts[key] = text;
		if (text.trim() === '') {
			delete values[key];
			jsonErrors[key] = false;
			onchanged();
			return;
		}
		try {
			values[key] = JSON.parse(text) as JsonValue;
			jsonErrors[key] = false;
			onchanged();
		} catch {
			jsonErrors[key] = true;
		}
	}

	function commitString(key: string, text: string): void {
		if (text === '') delete values[key];
		else values[key] = text;
		onchanged();
	}

	function commitNumber(key: string, text: string): void {
		if (text.trim() === '') {
			delete values[key];
			onchanged();
			return;
		}
		const num = Number(text);
		if (!Number.isFinite(num)) return;
		values[key] = num;
		onchanged();
	}
</script>

{#if fields.length === 0}
	<p class="text-xs text-muted-foreground">이 컴포넌트에는 입력할 속성이 없습니다.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each fields as field (field.key)}
			<div class="flex flex-col gap-1">
				<span class="text-xs text-muted-foreground">
					{field.label || field.key}
					{#if field.required}
						<span class="text-destructive">*</span>
					{/if}
					{#if field.required && values[field.key] === undefined}
						<span class="text-amber-600 dark:text-amber-500">필수 값이 비어 있습니다</span>
					{/if}
				</span>
				{#if field.type === 'string'}
					<Input
						class="h-8"
						value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
						oninput={(inputEvent) => commitString(field.key, inputEvent.currentTarget.value)}
					/>
				{:else if field.type === 'number'}
					<Input
						class="h-8 w-40"
						type="number"
						value={typeof values[field.key] === 'number' ? (values[field.key] as number) : ''}
						oninput={(inputEvent) => commitNumber(field.key, inputEvent.currentTarget.value)}
					/>
				{:else if field.type === 'boolean'}
					<Switch
						checked={values[field.key] === true}
						onCheckedChange={(checked) => {
							values[field.key] = checked;
							onchanged();
						}}
					/>
				{:else}
					<Textarea
						class="font-mono text-xs"
						rows={3}
						placeholder={'JSON 값 (예: {"count": 3})'}
						value={jsonText(field.key)}
						oninput={(inputEvent) => (jsonDrafts[field.key] = inputEvent.currentTarget.value)}
						onblur={(blurEvent) => commitJson(field.key, blurEvent.currentTarget.value)}
					/>
					{#if jsonErrors[field.key]}
						<span class="text-xs text-destructive">올바른 JSON이 아닙니다.</span>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
{/if}
