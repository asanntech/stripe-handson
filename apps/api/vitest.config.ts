import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 実 PostgreSQL を共有するため、テストファイルは直列に実行する
    fileParallelism: false,
    // 競合テストはロック待ちを含むため既定より長めにする
    testTimeout: 15_000,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5436/app_test',
    },
  },
})
