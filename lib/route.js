/**
 * The two HTTP routes the browser half uses: read and write the preference
 * document. Both are fenced to loopback (plus a live paired device when
 * remote-web-ui is loaded) and require a custom header so a cross-site form
 * cannot read or overwrite the preference.
 * @module dsh-thinking-phrase/lib/route
 */

import { isLoopbackRequest } from './loopback.js'

/** Path the browser half reads. */
export const CONFIG_ROUTE = '/thinking-phrase/config'

/** Path the browser half writes. */
export const SAVE_ROUTE = '/thinking-phrase/save'

/** Header a same-origin client must set; cross-site forms cannot. */
export const REQUEST_MARKER = 'x-dsh-thinking-phrase'

/** Body cap for the write route. */
const MAX_BODY_BYTES = 32 * 1024

/** Response headers. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
}

/**
 * Build the read handler.
 * @param {{ get?(name: string, strict?: boolean): unknown, logger?: { warn?: (message: string) => void }, remoteWebUiPairing?: { isPairedDevice(request: import('node:http').IncomingMessage): boolean } }} ctx - host context.
 * @param {{ get(): Promise<Record<string, unknown>> }} store - the settings store.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} the handler.
 */
export function createConfigHandler(ctx, store) {
  return async (req, res) => {
    if (!isAllowed(ctx, req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (req.headers[REQUEST_MARKER] === undefined) {
      writeJson(res, 403, { ok: false, error: 'forbidden: missing request marker' })
      return
    }
    const body = await readBody(req)
    if (body.status === 'tooLarge') {
      writeJson(res, 413, { ok: false, error: 'body too large' })
      return
    }
    if (body.status === 'invalid') {
      writeJson(res, 400, { ok: false, error: 'body must be JSON' })
      return
    }
    try {
      writeJson(res, 200, { ok: true, value: await store.get() })
    } catch (error) {
      ctx.logger?.warn?.(`thinking-phrase: read failed: ${String(error)}`)
      writeJson(res, 500, { ok: false, error: 'internal error' })
    }
  }
}

/**
 * Build the write handler.
 * @param {{ get?(name: string, strict?: boolean): unknown, logger?: { warn?: (message: string) => void }, remoteWebUiPairing?: { isPairedDevice(request: import('node:http').IncomingMessage): boolean } }} ctx - host context.
 * @param {{ put(raw: unknown): Promise<Record<string, unknown>> }} store - the settings store.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} the handler.
 */
export function createSaveHandler(ctx, store) {
  return async (req, res) => {
    if (!isAllowed(ctx, req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (req.headers[REQUEST_MARKER] === undefined) {
      writeJson(res, 403, { ok: false, error: 'forbidden: missing request marker' })
      return
    }
    const body = await readBody(req)
    if (body.status === 'tooLarge') {
      writeJson(res, 413, { ok: false, error: 'body too large' })
      return
    }
    if (body.status === 'invalid') {
      writeJson(res, 400, { ok: false, error: 'body must be JSON' })
      return
    }
    const payload = body.value
    if (payload === null || typeof payload !== 'object' || !Object.hasOwn(payload, 'settings')) {
      writeJson(res, 400, { ok: false, error: 'settings is required' })
      return
    }
    try {
      const stored = await store.put(payload.settings)
      writeJson(res, 200, { ok: true, value: stored })
    } catch (error) {
      ctx.logger?.warn?.(`thinking-phrase: write failed: ${String(error)}`)
      writeJson(res, 500, { ok: false, error: 'could not save the settings' })
    }
  }
}

/**
 * Loopback always passes; a live paired device passes when that plugin is
 * loaded. The pairing service is read only through `ctx.get`, because a Cordis
 * context is a Proxy that throws on a plain property read of an uninjected
 * service.
 */
function isAllowed(ctx, request) {
  if (isLoopbackRequest(request)) return true
  const pairing = typeof ctx.get === 'function' ? ctx.get('remoteWebUiPairing', false) : undefined
  return isPairing(pairing) ? pairing.isPairedDevice(request) === true : false
}

/** Narrow a value to the optional pairing service. */
function isPairing(value) {
  return value !== undefined && value !== null && typeof value.isPairedDevice === 'function'
}

/**
 * Read one request body under the cap. An oversized body is drained and
 * discarded rather than destroying the socket, so the 413 can still be sent.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<{status: 'ok', value: any} | {status: 'invalid'} | {status: 'tooLarge'}>} the body.
 */
async function readBody(req) {
  let size = 0
  let tooLarge = false
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      tooLarge = true
      continue
    }
    chunks.push(chunk)
  }
  if (tooLarge) return { status: 'tooLarge' }
  try {
    return { status: 'ok', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { status: 'invalid' }
  }
}

/** Write one JSON envelope. */
function writeJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}
