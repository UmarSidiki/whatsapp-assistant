import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import { whatsappRouter } from './routes/whatsapp'
import { aiRouter } from './routes/ai'
import { logger } from './lib/logger'
import inviteCodes from './config/invite-codes.json'
import { restoreScheduledMessages } from './services/schedule.service'

const app = new Hono()

// Restore scheduled messages from DB on startup
restoreScheduledMessages().catch(e => logger.error("Failed to restore scheduled messages", e))

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
}))

// Intercept sign-up to validate invite code against invite-codes.json
// Set codes to [] in the JSON to disable the requirement entirely.
app.post('/api/auth/sign-up/email', async (c) => {
  const body = await c.req.json()
  const { inviteCode, ...rest } = body

  const codes = inviteCodes as string[]
  if (codes.length > 0 && !codes.includes(inviteCode)) {
    logger.warn('Invalid registration code attempt', { inviteCode })
    return c.json({ message: 'Invalid registration code' }, 403)
  }

  // Forward to Better-Auth without the inviteCode field
  const newReq = new Request(c.req.url, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: JSON.stringify(rest),
  })
  return auth.handler(newReq)
})

app.all('/api/auth/*', (c) => auth.handler(c.req.raw))
app.route('/api/whatsapp', whatsappRouter)
app.route('/api/ai', aiRouter)

app.get('/', (c) => {
  logger.info('Health check')
  return c.text('Hello Hono!')
})

const port = process.env.PORT || 3000
export default {
  port,
  fetch: app.fetch,
}
