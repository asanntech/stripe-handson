import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'
import { requireEnv } from './src/config'

// drizzle-kit は .env を読まないため、リポジトリ直下の .env があれば読み込む（シェルの環境変数は上書きしない）
const envFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: requireEnv('DATABASE_URL'),
  },
})
