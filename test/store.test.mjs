import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  DECODE_STYLES,
  EFFECTS,
  MAX_PHRASES,
  cleanDecodeStyles,
  cleanEffects,
  cleanPhrases,
  createSettingsStore,
  normalizeSettings,
} from '../lib/store.js'

test('default settings reproduce the stock label', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    enabled: true,
    phrases: ['深度求索中，用时 {duration}'],
    random: false,
    glitch: false,
    glitchChance: 35,
    effect: 'default',
    effectPool: [],
    randomEffect: false,
    decodeStyles: ['blocks'],
    decodeSpeedMs: 40,
    cycleSeconds: 4,
    typeSpeedMs: 45,
  })
  assert.deepEqual(EFFECTS, ['default', 'typewriter', 'terminal', 'decode'])
  assert.deepEqual(DECODE_STYLES, ['blocks', 'hex'])
})

test('the decode styles are a pick, and an empty pick still has a look', () => {
  assert.deepEqual(cleanDecodeStyles(['hex']), ['hex'])
  assert.deepEqual(cleanDecodeStyles(['hex', 'blocks']), ['blocks', 'hex'])
  assert.deepEqual(cleanDecodeStyles(['hex', 'hex', 'rainbow', 42]), ['hex'])
  assert.deepEqual(cleanDecodeStyles([]), ['blocks'])
  assert.deepEqual(cleanDecodeStyles(undefined), ['blocks'])
  // A document written before this field became a pick still reads.
  assert.deepEqual(cleanDecodeStyles('hex'), ['hex'])
  assert.deepEqual(normalizeSettings({ decodeStyle: 'hex' }).decodeStyles, ['hex'])
  assert.deepEqual(normalizeSettings({ decodeStyles: ['blocks', 'hex'] }).decodeStyles, ['blocks', 'hex'])
  assert.equal(normalizeSettings({ decodeSpeedMs: 5 }).decodeSpeedMs, 10)
  assert.equal(normalizeSettings({ decodeSpeedMs: 9999 }).decodeSpeedMs, 300)
  assert.equal(normalizeSettings({ decodeSpeedMs: '80' }).decodeSpeedMs, 80)
  assert.equal(normalizeSettings(undefined).decodeSpeedMs, 40)
})

test('the effect pool keeps known effects, in order, without repeats', () => {
  assert.deepEqual(cleanEffects(['decode', 'terminal', 'decode', 'nope', 42]), ['terminal', 'decode'])
  assert.deepEqual(cleanEffects([]), [])
  assert.deepEqual(cleanEffects(undefined), [])
  assert.deepEqual(cleanEffects('decode'), [])
  // An effect this build no longer offers is dropped, not carried as a stale pick.
  assert.deepEqual(cleanEffects(['wipe', 'decode']), ['decode'])
})

test('the host narrows the random switch to a boolean', () => {
  assert.equal(normalizeSettings({ random: true }).random, true)
  assert.equal(normalizeSettings({ random: 'yes' }).random, false)
  assert.equal(normalizeSettings(undefined).random, false)
})

test('the host narrows the glitch switch to a boolean', () => {
  assert.equal(normalizeSettings({ glitch: true }).glitch, true)
  assert.equal(normalizeSettings({ glitch: 'yes' }).glitch, false)
  assert.equal(normalizeSettings(undefined).glitch, false)
})

test('the host clamps the typo chance to a percentage', () => {
  assert.equal(normalizeSettings({ glitchChance: 0 }).glitchChance, 0)
  assert.equal(normalizeSettings({ glitchChance: 150 }).glitchChance, 100)
  assert.equal(normalizeSettings({ glitchChance: -5 }).glitchChance, 0)
  assert.equal(normalizeSettings({ glitchChance: '40' }).glitchChance, 40)
  assert.equal(normalizeSettings(undefined).glitchChance, 35)
})

test('the host keeps the terminal effect and falls back for unknown ones', () => {
  assert.equal(normalizeSettings({ effect: 'terminal' }).effect, 'terminal')
  assert.equal(normalizeSettings({ effect: 'explode' }).effect, 'default')
})

test('normalizeSettings repairs unknown and out-of-range values', () => {
  const settings = normalizeSettings({
    enabled: false,
    phrases: ['  first  ', '', 'second\nignored', 42],
    effect: 'explode',
    cycleSeconds: 999,
    typeSpeedMs: -1,
  })
  assert.deepEqual(settings, {
    enabled: false,
    phrases: ['first', 'second'],
    random: false,
    glitch: false,
    glitchChance: 35,
    effect: 'default',
    effectPool: [],
    randomEffect: false,
    decodeStyles: ['blocks'],
    decodeSpeedMs: 40,
    cycleSeconds: 60,
    typeSpeedMs: 10,
  })
})

test('cleanPhrases caps lines at the stored limit and falls back to the default', () => {
  const many = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
  assert.equal(MAX_PHRASES, 25)
  assert.equal(cleanPhrases(many).length, MAX_PHRASES)
  assert.equal(cleanPhrases(many)[MAX_PHRASES - 1], 'line ' + MAX_PHRASES)
  assert.deepEqual(cleanPhrases([]), ['深度求索中，用时 {duration}'])
  assert.deepEqual(cleanPhrases([null, '', '  ']), ['深度求索中，用时 {duration}'])
})

test('settings store round-trips through an atomic JSON document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-thinking-phrase-'))
  const file = join(directory, 'nested', 'settings.json')
  try {
    const store = createSettingsStore({ file })
    assert.deepEqual(await store.get(), normalizeSettings(undefined))

    const saved = await store.put({
      enabled: false,
      phrases: ['hello {duration}', 'second'],
      random: true,
      glitch: true,
      glitchChance: 45,
      effect: 'typewriter',
      effectPool: ['decode', 'terminal'],
      randomEffect: true,
      decodeStyles: ['blocks', 'hex'],
      decodeSpeedMs: 90,
      cycleSeconds: 7,
      typeSpeedMs: 30,
    })
    assert.equal(saved.effect, 'typewriter')
    assert.equal(saved.glitch, true)
    assert.deepEqual(saved.effectPool, ['terminal', 'decode'])
    assert.equal(saved.randomEffect, true)
    assert.deepEqual(saved.decodeStyles, ['blocks', 'hex'])
    assert.deepEqual(await store.get(), saved)

    const text = await readFile(file, 'utf8')
    assert.match(text, /"typewriter"/)
    assert.match(text, /"glitch": true/)
    assert.match(text, /"glitchChance": 45/)
    assert.match(text, /"randomEffect": true/)
    assert.match(text, /"decodeStyles"/)
    // The old single-value key is migrated on read and never written back.
    assert.doesNotMatch(text, /"decodeStyle":/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a migrated document writes only the new field', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-thinking-phrase-'))
  const file = join(directory, 'settings.json')
  try {
    const { writeFile } = await import('node:fs/promises')
    // A document from before the pick existed.
    await writeFile(file, JSON.stringify({ decodeStyle: 'hex', effect: 'decode' }), 'utf8')
    const store = createSettingsStore({ file })
    assert.deepEqual((await store.get()).decodeStyles, ['hex'])
    await store.put({ decodeStyle: 'hex', effect: 'decode' })
    const text = await readFile(file, 'utf8')
    assert.match(text, /"decodeStyles"/)
    assert.doesNotMatch(text, /"decodeStyle":/)
    // The new shape wins when both are present, on both halves.
    const both = { decodeStyle: 'hex', decodeStyles: ['blocks'] }
    assert.deepEqual(normalizeSettings(both).decodeStyles, ['blocks'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt document still allows a later write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-thinking-phrase-'))
  const file = join(directory, 'settings.json')
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '{not-json', 'utf8')
    const warnings = []
    const store = createSettingsStore({ file, warn: (message) => warnings.push(message) })
    assert.deepEqual(await store.get(), normalizeSettings(undefined))
    const saved = await store.put({ phrases: ['still works'] })
    assert.deepEqual(await store.get(), saved)
    assert.equal(warnings.length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
