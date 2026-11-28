import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// リポジトリ直下の .env があれば読み込む（docker compose と同じ接続先を使うため）。
// シェルで設定済みの環境変数は上書きしない
const envFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

// globalSetup はテストワーカーの env を参照しないため、プロセス環境変数として既定値を入れる
process.env.TEST_DATABASE_URL ??= 'postgres://app:app@localhost:5436/app_test'

export default defineConfig({
  resolve: {
    // tsconfig の paths（@/* → src/*、@test/* → test/*）と揃える。'@orpc/...' などのスコープ付きパッケージには当たらない
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      { find: /^@test\//, replacement: fileURLToPath(new URL('./test/', import.meta.url)) },
    ],
  },
  test: {
    // 実 PostgreSQL を共有するため、テストファイルは直列に実行する
    fileParallelism: false,
    globalSetup: ['./test/setup/global-setup.ts'],
    // 競合テストはロック待ちを含むため既定より長めにする
    testTimeout: 15_000,
  },
})
