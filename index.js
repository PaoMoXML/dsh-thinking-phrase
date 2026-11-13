/**
 * dsh-thinking-phrase — host half.
 *
 * The browser owns every pixel and every animation frame; this half only keeps
 * one small preference document beside the other DSH user data so a setting
 * follows every browser of this DSH home and survives a restart.
 * @module dsh-thinking-phrase
 */

import { createSettingsStore } from './lib/store.js'
import { CONFIG_ROUTE, SAVE_ROUTE, createConfigHandler, createSaveHandler } from './lib/route.js'

export const name = 'dsh-thinking-phrase'

/**
 * Host entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 */
export function apply(ctx) {
  const store = createSettingsStore({ warn: (message) => ctx.logger?.warn?.(message) })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: CONFIG_ROUTE,
        handler: createConfigHandler(webCtx, store),
      }),
      'dsh-thinking-phrase: config route',
    )
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: SAVE_ROUTE,
        handler: createSaveHandler(webCtx, store),
      }),
      'dsh-thinking-phrase: save route',
    )
  })
}
