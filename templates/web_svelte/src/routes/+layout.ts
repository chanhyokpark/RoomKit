// 정적 어댑터용: 빈 셸을 미리 렌더링하고 실제 화면은 브라우저에서 그립니다.
// Helper는 Player iframe 안(브라우저)에서만 동작하므로 SSR을 끕니다.
export const prerender = true;
export const ssr = false;
