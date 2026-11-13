import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    // 开发态把协同接口与健康检查代理到本地协同服务；同源部署（veFaaS 单服务）时无需代理
    proxy: {
      '/api': 'http://localhost:3001',
      '/ping': 'http://localhost:3001',
    },
  },
})
