import { orpc } from './setup.js'

export const router = orpc.router({
  health: {
    check: orpc.health.check.handler(async ({ context }) => {
      await context.checkDatabase()
      return { status: 'ok', database: 'ok' }
    }),
  },
})
