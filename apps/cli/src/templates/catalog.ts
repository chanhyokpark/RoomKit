export interface TemplateSpec {
  /** Directory under templates/ in the repository. */
  dir: string;
  label: string;
  hint: string;
  build: string;
  dist: string;
  dev: string;
  /** Default dev server origin (Vite / SvelteKit default port). */
  devUrl: string;
}

export const TEMPLATES = {
  web: { dir: 'web', label: 'React 웹사이트', hint: 'Vite + React + Tailwind, @roomkit/helper-react', build: 'pnpm build', dist: 'dist', dev: 'pnpm dev', devUrl: 'http://localhost:5173' },
  web_svelte: { dir: 'web_svelte', label: 'Svelte 웹사이트', hint: 'SvelteKit(static) + Tailwind, @roomkit/helper-svelte', build: 'pnpm build', dist: 'build', dev: 'pnpm dev', devUrl: 'http://localhost:5173' },
} as const satisfies Record<string, TemplateSpec>;

export type TemplateId = keyof typeof TEMPLATES;

const ALIASES: Record<string, TemplateId> = { react: 'web', web: 'web', svelte: 'web_svelte', web_svelte: 'web_svelte', sveltekit: 'web_svelte' };

export function resolveTemplateId(value: string): TemplateId | null {
  return ALIASES[value.toLowerCase()] ?? null;
}
