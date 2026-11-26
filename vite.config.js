import { defineConfig } from 'vite';

// OneDrive 등으로 mp3가 잠기면 Vite 파일 감시가 EBUSY로 죽을 수 있어
// 음성·모델 폴더는 감시에서 빼 둔다.
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/public/audio/**', '**/public/models/**'],
    },
  },
});
