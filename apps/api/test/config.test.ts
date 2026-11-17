import { describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'

describe('requireEnv', () => {
  it('環境変数が設定されているとき その値を返す', () => {
    expect(requireEnv('DATABASE_URL', { DATABASE_URL: 'postgres://example' })).toBe(
      'postgres://example',
    )
  })

  it('環境変数が未設定のとき 変数名を含むエラーで起動を止める', () => {
    expect(() => requireEnv('DATABASE_URL', {})).toThrow('DATABASE_URL')
  })

  it('環境変数が空文字のとき 未設定と同じくエラーにする', () => {
    expect(() => requireEnv('DATABASE_URL', { DATABASE_URL: '' })).toThrow('DATABASE_URL')
  })
})
