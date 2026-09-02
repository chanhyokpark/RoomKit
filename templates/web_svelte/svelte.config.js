import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // 정적 사이트로 빌드합니다. build/ 내용물을 그대로 ZIP 호스팅에 올릴 수
    // 있습니다 (index.html이 루트).
    adapter: adapter(),
  },
};

export default config;
