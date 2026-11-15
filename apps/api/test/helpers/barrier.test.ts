import { setTimeout } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createBarrier } from './barrier.js'

describe('バリア', () => {
  it('A→B の順に固定したとき 処理 A の完了後にのみ処理 B が進む', async () => {
    const aDone = createBarrier()
    const events: string[] = []

    // B を先に起動しても、A がバリアを開くまでは進まない
    const b = (async () => {
      await aDone.wait()
      events.push('B')
    })()
    const a = (async () => {
      await setTimeout(20)
      expect(events).toEqual([])
      events.push('A')
      aDone.open()
    })()
    await Promise.all([a, b])

    expect(events).toEqual(['A', 'B'])
  })

  it('先に開いておいたとき 後から待った処理は即座に進む', async () => {
    const barrier = createBarrier()
    barrier.open()

    await expect(barrier.wait()).resolves.toBeUndefined()
  })
})
