import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // Player가 같은 네트워크에서 개발 서버에 접근할 수 있도록 모든 인터페이스에 엽니다.
  server: { host: '0.0.0.0' },
});
