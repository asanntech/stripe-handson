import { defineConfig } from 'vitest/config'

// globalSetup はテストワーカーの env を参照しないため、プロセス環境変数として既定値を入れる
process.env.TEST_DATABASE_URL ??= 'postgres://app:app@localhost:5436/app_test'

export default defineConfig({
  test: {
    // 実 PostgreSQL を共有するため、テストファイルは直列に実行する
    fileParallelism: false,
    globalSetup: ['./test/setup/global-setup.ts'],
    // 競合テストはロック待ちを含むため既定より長めにする
    testTimeout: 15_000,
  },
})
