import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './core/auth'
import { adminRouter } from './modules/admin/routes'
import { whatsappRouter } from './modules/whatsapp/routes'
import { aiRouter } from './modules/ai/routes'
import { logger } from './core/logger'
import { inviteCodes, getAppConfig } from './core/config'
import { restoreScheduledMessages } from './modules/scheduling/services'
import { autoReconnectAll } from './modules/whatsapp/services'
import { startAIMaintenanceScheduler } from './modules/ai/services'
import { apiGuard } from './core/middleware'

declare const Bun: {
  serve: (options: { fetch: typeof app.fetch; port: number }) => unknown
}

const app = new Hono()

// Auto-reconnect all WhatsApp sessions from stored auth
autoReconnectAll().catch(e => logger.error("Failed to auto-reconnect WhatsApp sessions", e))

// Keep AI data fresh and bounded (top 20 chats, every 6 hours)
startAIMaintenanceScheduler()

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', frontendUrl],
  credentials: true,
}))

// Intercept sign-up to validate invite code against invite-codes.json
// Set codes to [] in the JSON to disable the requirement entirely.
app.post('/api/auth/sign-up/email', async (c) => {
  const parseSignupBody = async () => {
    const rawBody: unknown = await c.req.json()

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return null
    }

    return rawBody as Record<string, unknown>
  }

  let body: Record<string, unknown> | null = null

  try {
    body = await parseSignupBody()
  } catch (error) {
    logger.error('Failed to parse signup request body', { error })
    return c.json({ message: 'Invalid request body' }, 400)
  }

  if (!body) {
    return c.json({ message: 'Invalid request body' }, 400)
  }

  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode : ''
  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''

  if (!phoneNumber) {
    return c.json({ message: 'phoneNumber is required' }, 400)
  }

  const codes = inviteCodes as string[]
  if (codes.length > 0 && inviteCode && !codes.includes(inviteCode)) {
    logger.warn('Invalid registration code attempt', { inviteCode })
    return c.json({ message: 'Invalid registration code' }, 403)
  }

  // Forward to Better-Auth without inviteCode.
  const { inviteCode: _inviteCode, ...rest } = body
  const newReq = new Request(c.req.url, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: JSON.stringify(rest),
  })

  let response: Response

  try {
    response = await auth.handler(newReq)
  } catch (error) {
    logger.error('Signup handler failed', { error, phoneNumber })
    return c.json({ message: 'Failed to create account' }, 500)
  }

  if (!response.ok) {
    return response
  }

  return response
})

app.all('/api/auth/*', (c) => auth.handler(c.req.raw))
app.route('/api/admin', adminRouter)
app.route('/api/whatsapp', whatsappRouter)
app.route('/api/ai', aiRouter)

app.get('/api/health', (c) => {
  logger.info('Health check')
  return c.text('Hello Hono!')
})

// Serve static frontend files
import { serveStatic } from 'hono/bun'

// API guard: prevent unmatched /api/* routes from falling through to SPA
app.use('*', apiGuard)

app.use('/*', serveStatic({ root: '../web/dist' }))
app.use('*', serveStatic({ path: '../web/dist/index.html' })) // SPA fallback

const port = Number(process.env.PORT || 3000)

console.log(`Server is running on http://localhost:${port}`)
Bun.serve({
  fetch: app.fetch,
  port,
})
