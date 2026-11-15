import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5436/app',
  },
})
