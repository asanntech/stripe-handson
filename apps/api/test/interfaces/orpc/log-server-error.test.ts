import { ORPCError } from '@orpc/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logServerError } from '@/interfaces/orpc/log-server-error'

describe('logServerError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('5xx の ORPCError のとき procedure 名付きでログに出す', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new ORPCError('SERVICE_UNAVAILABLE', { status: 503 })

    logServerError(error, ['health', 'check'])

    expect(consoleError).toHaveBeenCalledWith('[health.check]', error)
  })

  it('4xx の ORPCError のとき ログに出さない', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    logServerError(new ORPCError('BAD_REQUEST', { status: 400 }), ['health', 'check'])

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('ORPCError 以外の例外（バグ）のとき 500 とみなしてログに出す', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bug = new Error('想定外のバグ')

    logServerError(bug, ['health', 'check'])

    expect(consoleError).toHaveBeenCalledWith('[health.check]', bug)
  })
})
