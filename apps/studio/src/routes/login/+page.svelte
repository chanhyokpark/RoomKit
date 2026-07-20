<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { ApiError } from '$lib/api/client';
	import { auth } from '$lib/stores/auth.svelte';

	let id = $state('');
	let password = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		if (auth.isAuthenticated) void goto(resolve('/'));
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		errorMessage = null;
		try {
			await auth.login(id, password);
			await goto(resolve('/'));
		} catch (error) {
			errorMessage =
				error instanceof ApiError && error.status === 401
					? '아이디 또는 비밀번호가 올바르지 않습니다.'
					: '로그인에 실패했습니다. 서버 연결을 확인해 주세요.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>로그인 · RoomKit Studio</title></svelte:head>

<div class="flex min-h-svh items-center justify-center p-4">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title>RoomKit Studio</Card.Title>
			<Card.Description>관리자 계정으로 로그인하세요.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form onsubmit={handleSubmit}>
				<Field.FieldGroup>
					<Field.Field data-invalid={errorMessage ? true : undefined}>
						<Field.FieldLabel for="login-id">아이디</Field.FieldLabel>
						<Input
							id="login-id"
							autocomplete="username"
							required
							bind:value={id}
							aria-invalid={errorMessage ? true : undefined}
						/>
					</Field.Field>
					<Field.Field data-invalid={errorMessage ? true : undefined}>
						<Field.FieldLabel for="login-password">비밀번호</Field.FieldLabel>
						<Input
							id="login-password"
							type="password"
							autocomplete="current-password"
							required
							bind:value={password}
							aria-invalid={errorMessage ? true : undefined}
						/>
						{#if errorMessage}
							<Field.FieldDescription class="text-destructive">
								{errorMessage}
							</Field.FieldDescription>
						{/if}
					</Field.Field>
					<Button type="submit" disabled={submitting} class="w-full">
						{#if submitting}
							<Spinner data-icon="inline-start" />
						{/if}
						로그인
					</Button>
				</Field.FieldGroup>
			</form>
		</Card.Content>
	</Card.Root>
</div>
