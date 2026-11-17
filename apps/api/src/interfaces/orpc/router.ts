import { orpc } from './setup'

export const router = orpc.router({
  health: {
    check: orpc.health.check.handler(async ({ context }) => {
      await context.checkDatabase()
      return { status: 'ok', database: 'ok' }
    }),
  },
})
