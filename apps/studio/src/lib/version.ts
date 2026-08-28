import { env } from '$env/dynamic/public';
import { EXPECTED_VERSIONS, isVersionBelow, type VersionedComponent } from '@roomkit/shared';

/**
 * Minimum component versions the operation screen warns below.
 * Defaults come from the shared protocol package; a deployment can override
 * them without a rebuild (adapter-node) via the environment variables below.
 */
export const expectedVersions: Record<VersionedComponent, string> = {
	player: env.PUBLIC_EXPECTED_PLAYER_VERSION || EXPECTED_VERSIONS.player,
	client: env.PUBLIC_EXPECTED_CLIENT_VERSION || EXPECTED_VERSIONS.client,
	helper: env.PUBLIC_EXPECTED_HELPER_VERSION || EXPECTED_VERSIONS.helper
};

/**
 * True when a detected version is below the expected minimum. `null` (the
 * component was detected but predates version reporting) counts as below;
 * `undefined` (nothing detected, or the server predates version relaying)
 * never warns.
 */
export function isOutdated(
	kind: VersionedComponent,
	version: string | null | undefined
): boolean {
	return version !== undefined && isVersionBelow(version, expectedVersions[kind]);
}

export function versionLabel(version: string | null): string {
	return version === null ? '버전 미상 (구버전)' : `v${version}`;
}

const KIND_LABELS: Record<VersionedComponent, string> = {
	player: '플레이어 앱',
	client: '클라이언트 라이브러리(@roomkit/client)',
	helper: '헬퍼 스크립트(@roomkit/helper)'
};

/** One warning line for the amber banner, or null when the version is fine. */
export function versionWarning(
	kind: VersionedComponent,
	version: string | null | undefined,
	subject: string
): string | null {
	if (!isOutdated(kind, version)) return null;
	return `${subject}의 ${KIND_LABELS[kind]}이(가) 오래되었습니다 (${versionLabel(
		version ?? null
	)}, 권장 v${expectedVersions[kind]} 이상).`;
}
