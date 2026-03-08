import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './core/auth'
import { whatsappRouter } from './modules/whatsapp/routes'
import { aiRouter } from './modules/ai/routes'
import { logger } from './core/logger'
import inviteCodes from './config/invite-codes.json'
import { restoreScheduledMessages } from './modules/scheduling/schedule.service'
import { autoReconnectAll } from './modules/whatsapp/wa-connection.service'

const app = new Hono()

// Auto-reconnect all WhatsApp sessions from stored auth
autoReconnectAll().catch(e => logger.error("Failed to auto-reconnect WhatsApp sessions", e))

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', frontendUrl],
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

app.get('/api/health', (c) => {
  logger.info('Health check')
  return c.text('Hello Hono!')
})

// Serve static frontend files
import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
app.use('/*', serveStatic({ root: '../web/dist' }))
app.use('*', serveStatic({ path: '../web/dist/index.html' })) // SPA fallback

const port = Number(process.env.PORT || 3000)
serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
