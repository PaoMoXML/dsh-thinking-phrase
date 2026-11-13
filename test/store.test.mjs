import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  DECODE_STYLES,
  EFFECTS,
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
    decodeStyle: 'blocks',
    decodeSpeedMs: 40,
    cycleSeconds: 4,
    typeSpeedMs: 45,
  })
  assert.deepEqual(EFFECTS, ['default', 'typewriter', 'terminal', 'decode'])
  assert.deepEqual(DECODE_STYLES, ['blocks', 'hex'])
})

test('the decode settings narrow to their own shape', () => {
  assert.equal(normalizeSettings({ decodeStyle: 'hex' }).decodeStyle, 'hex')
  assert.equal(normalizeSettings({ decodeStyle: 'rainbow' }).decodeStyle, 'blocks')
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
    decodeStyle: 'blocks',
    decodeSpeedMs: 40,
    cycleSeconds: 60,
    typeSpeedMs: 10,
  })
})

test('cleanPhrases caps lines and falls back to the default phrase', () => {
  const many = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)
  assert.equal(cleanPhrases(many).length, 20)
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
      decodeStyle: 'hex',
      decodeSpeedMs: 90,
      cycleSeconds: 7,
      typeSpeedMs: 30,
    })
    assert.equal(saved.effect, 'typewriter')
    assert.equal(saved.glitch, true)
    assert.deepEqual(saved.effectPool, ['terminal', 'decode'])
    assert.equal(saved.randomEffect, true)
    assert.equal(saved.decodeStyle, 'hex')
    assert.deepEqual(await store.get(), saved)

    const text = await readFile(file, 'utf8')
    assert.match(text, /"typewriter"/)
    assert.match(text, /"glitch": true/)
    assert.match(text, /"glitchChance": 45/)
    assert.match(text, /"randomEffect": true/)
    assert.match(text, /"decodeStyle": "hex"/)
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
