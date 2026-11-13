/**
 * Durable preferences for the thinking-phrase plugin.
 *
 * This is presentation state, not session data: losing the file only restores
 * the stock running label. Writes are read-modify-write against the file and
 * land through a temporary file plus rename, so an abrupt exit cannot leave a
 * half-written JSON document behind.
 * @module dsh-thinking-phrase/lib/store
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Environment variable that overrides the Harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/** Effects the browser knows how to draw. */
export const EFFECTS = ['default', 'typewriter', 'terminal', 'decode']

/** How decode draws its unresolved glyphs. */
export const DECODE_STYLES = ['blocks', 'hex']

/** The longest phrase accepted, in code points. */
export const MAX_PHRASE_LENGTH = 120

/** The most phrases one configuration may carry. */
export const MAX_PHRASES = 25

/** The shipped preference; the default phrase reproduces the stock label. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  phrases: Object.freeze(['深度求索中，用时 {duration}']),
  random: false,
  glitch: false,
  glitchChance: 35,
  effect: 'default',
  effectPool: Object.freeze([]),
  randomEffect: false,
  decodeStyles: Object.freeze(['blocks']),
  decodeSpeedMs: 40,
  cycleSeconds: 4,
  typeSpeedMs: 45,
})

/**
 * Resolve the Harness home the same way the Host does: the environment
 * override wins, then `~/.dsh`.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @param {string} [home] - platform home (test seam).
 * @returns {string} the absolute Harness home.
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env[DSH_HOME_ENV]
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = raw.trim()
    if (value === '~') return home
    if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(home, value.slice(2))
    return resolve(value)
  }
  return join(home, '.dsh')
}

/** Clamp one finite integer, falling back when the value is unusable. */
function clampInteger(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * Keep at most {@link MAX_PHRASES} non-empty one-line phrases, slicing by code
 * point so a cut cannot leave half a surrogate pair behind.
 * @param {unknown} value - raw phrases.
 * @returns {string[]} the cleaned list.
 */
export function cleanPhrases(value) {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.phrases]
  const phrases = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.replace(/\r\n?/g, '\n').split('\n')[0].trim()
    if (text === '') continue
    phrases.push(Array.from(text).slice(0, MAX_PHRASE_LENGTH).join(''))
    if (phrases.length >= MAX_PHRASES) break
  }
  return phrases.length > 0 ? phrases : [...DEFAULT_SETTINGS.phrases]
}

/**
 * Keep only known effects, in the canonical order, without repeats.
 * @param {unknown} value - raw pool entries.
 * @returns {string[]} the cleaned pool; empty means "no pool".
 */
export function cleanEffects(value) {
  if (!Array.isArray(value)) return []
  const picked = new Set(value.filter((item) => typeof item === 'string' && EFFECTS.includes(item)))
  return EFFECTS.filter((effect) => picked.has(effect))
}

/**
 * Keep only known decode styles, in the canonical order, without repeats. An
 * empty pick falls back to the symbol style, so the effect always has a look.
 * @param {unknown} value - raw picked styles, or the single value older documents hold.
 * @returns {string[]} one or more styles.
 */
export function cleanDecodeStyles(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : [])
  const picked = new Set(list.filter((item) => typeof item === 'string' && DECODE_STYLES.includes(item)))
  const styles = DECODE_STYLES.filter((style) => picked.has(style))
  return styles.length > 0 ? styles : ['blocks']
}

/**
 * Narrow one stored or posted value to a complete preference object.
 * Unknown effects fall back to `default`; every numeric field is clamped.
 * @param {unknown} raw - a parsed JSON value.
 * @returns {{enabled: boolean, phrases: string[], random: boolean, glitch: boolean, glitchChance: number, effect: string, effectPool: string[], randomEffect: boolean, decodeStyles: string[], decodeSpeedMs: number, cycleSeconds: number, typeSpeedMs: number}} the normalized settings.
 */
export function normalizeSettings(raw) {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, unknown>} */ (raw)
    : {}
  return {
    enabled: record.enabled !== false,
    phrases: cleanPhrases(record.phrases),
    random: record.random === true,
    glitch: record.glitch === true,
    glitchChance: clampInteger(record.glitchChance, 0, 100, DEFAULT_SETTINGS.glitchChance),
    effect: typeof record.effect === 'string' && EFFECTS.includes(record.effect) ? record.effect : 'default',
    effectPool: cleanEffects(record.effectPool),
    randomEffect: record.randomEffect === true,
    // `decodeStyle` is the single-value shape this field had before styles became
    // a pick; an old document is read through it and then rewritten.
    decodeStyles: cleanDecodeStyles(record.decodeStyles !== undefined ? record.decodeStyles : record.decodeStyle),
    decodeSpeedMs: clampInteger(record.decodeSpeedMs, 10, 300, DEFAULT_SETTINGS.decodeSpeedMs),
    cycleSeconds: clampInteger(record.cycleSeconds, 1, 60, DEFAULT_SETTINGS.cycleSeconds),
    typeSpeedMs: clampInteger(record.typeSpeedMs, 10, 300, DEFAULT_SETTINGS.typeSpeedMs),
  }
}

/**
 * Open the settings store.
 * @param {{ file?: string, warn?: (message: string) => void }} [options] - overrides for tests.
 */
export function createSettingsStore(options = {}) {
  const file = options.file ?? join(resolveDshHome(), 'thinking-phrase', 'settings.json')
  const warn = options.warn ?? (() => {})
  let queue = Promise.resolve()

  /**
   * Read the document; a missing file is the default, a corrupt file is
   * replaced on the next write instead of blocking every later save.
   * @returns {Promise<ReturnType<typeof normalizeSettings>>} the accepted settings.
   */
  async function read() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeSettings(undefined)
      warn(`thinking-phrase: cannot read settings, using defaults: ${String(error)}`)
      return normalizeSettings(undefined)
    }
    try {
      return normalizeSettings(JSON.parse(text))
    } catch (error) {
      warn(`thinking-phrase: replacing a corrupt settings file: ${String(error)}`)
      return normalizeSettings(undefined)
    }
  }

  /**
   * Replace the document atomically.
   * @param {ReturnType<typeof normalizeSettings>} settings - complete settings.
   */
  async function write(settings) {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
      await rename(temporary, file)
    } catch (error) {
      try {
        await unlink(temporary)
      } catch {
        // nothing to clean up, or it is already gone
      }
      throw error
    }
  }

  return {
    /** The store's file path (diagnostics and tests). */
    file,

    /** Read the current preference document. */
    get() {
      return read()
    },

    /**
     * Save one complete preference document.
     * @param {unknown} raw - the browser payload.
     * @returns {Promise<ReturnType<typeof normalizeSettings>>} the stored settings.
     */
    put(raw) {
      const settings = normalizeSettings(raw)
      const change = async () => {
        await write(settings)
        return settings
      }
      // A rejected write must not poison the queue for later saves.
      const result = queue.then(change, change)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  }
}
