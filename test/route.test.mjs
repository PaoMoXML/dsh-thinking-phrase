import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_ROUTE,
  REQUEST_MARKER,
  SAVE_ROUTE,
  createConfigHandler,
  createSaveHandler,
} from '../lib/route.js'

const SETTINGS = {
  enabled: true,
  phrases: ['hello'],
  effect: 'default',
  cycleSeconds: 4,
  typeSpeedMs: 45,
}

function request(body, overrides = {}) {
  const headers = {
    host: '127.0.0.1:3080',
    'sec-fetch-site': 'same-origin',
    [REQUEST_MARKER]: '1',
    'content-type': 'application/json',
    ...overrides.headers,
  }
  return {
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
    headers,
    method: overrides.method ?? 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body)
    },
  }
}

function response() {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += body
    },
  }
}

const context = { logger: { warn() {} }, get() {} }

test('config route returns the store value', async () => {
  const handler = createConfigHandler(context, { get: async () => SETTINGS })
  const res = response()
  await handler(request('{}'), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { ok: true, value: SETTINGS })
})

test('save route passes the posted settings to the store', async () => {
  let received
  const handler = createSaveHandler(context, {
    put: async (value) => {
      received = value
      return value
    },
  })
  const res = response()
  await handler(request(JSON.stringify({ settings: SETTINGS })), res)
  assert.deepEqual(received, SETTINGS)
  assert.equal(res.status, 200)
})

test('routes reject non-POST, missing markers, non-loopback and bad bodies', async () => {
  const handler = createConfigHandler(context, { get: async () => SETTINGS })

  const wrongMethod = response()
  await handler(request('{}', { method: 'GET' }), wrongMethod)
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')

  const noMarker = response()
  await handler(request('{}', { headers: { [REQUEST_MARKER]: undefined } }), noMarker)
  assert.equal(noMarker.status, 403)

  const remote = response()
  await handler(request('{}', { remoteAddress: '192.0.2.10' }), remote)
  assert.equal(remote.status, 403)

  const badBody = response()
  await handler(request('{oops'), badBody)
  assert.equal(badBody.status, 400)
})

test('save route requires a settings field', async () => {
  const handler = createSaveHandler(context, { put: async () => SETTINGS })
  const res = response()
  await handler(request('{}'), res)
  assert.equal(res.status, 400)
})

test('route path constants stay stable', () => {
  assert.equal(CONFIG_ROUTE, '/thinking-phrase/config')
  assert.equal(SAVE_ROUTE, '/thinking-phrase/save')
})
