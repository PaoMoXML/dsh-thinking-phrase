import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let loaded
const localStorage = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
  localStorage: {
    getItem(key) {
      return localStorage.has(key) ? localStorage.get(key) : null
    },
    setItem(key, value) {
      localStorage.set(key, value)
    },
  },
}

await import('../client.js')

const reactStub = {
  createElement: () => null,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
}
const core = loaded.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected module: ' + name)
})

test('client normalization matches the host contract', () => {
  assert.deepEqual(core.normalizeSettings({
    phrases: [' one ', '', 'two\nignored'],
    effect: 'terminal',
    cycleSeconds: 0,
    typeSpeedMs: 999,
  }), {
    enabled: true,
    phrases: ['one', 'two'],
    random: false,
    glitch: false,
    glitchChance: 35,
    effect: 'terminal',
    effectPool: [],
    randomEffect: false,
    decodeStyles: ['blocks'],
    decodeSpeedMs: 40,
    cycleSeconds: 1,
    typeSpeedMs: 300,
  })
})

test('textarea phrases keep one line each', () => {
  assert.deepEqual(core.phrasesFromTextarea('a\n\n  b  \nc\n'), ['a', 'b', 'c'])
})

test('duration placeholder is replaced verbatim', () => {
  assert.equal(core.applyDuration('深度求索中，用时 {duration}', '3 秒'), '深度求索中，用时 3 秒')
  assert.equal(core.applyDuration('x {duration} y', ''), 'x  y')
})

test('phraseIndexAt wraps through the phrase list', () => {
  assert.equal(core.phraseIndexAt(1, 4000, 12000), 0)
  assert.equal(core.phraseIndexAt(3, 4000, 0), 0)
  assert.equal(core.phraseIndexAt(3, 4000, 4100), 1)
  assert.equal(core.phraseIndexAt(3, 4000, 12100), 0)
})

test('default effect shows the complete phrase and moves nothing', () => {
  const settings = core.normalizeSettings({ phrases: ['深度求索中，用时 {duration}'] })
  const frame = core.effectFrame(settings, 0, '3 秒')
  assert.equal(frame.text, '深度求索中，用时 3 秒')
  assert.equal(frame.opacity, 1)
  assert.equal(frame.caret, false)
  // No effect assigns a displacement any more; a reintroduced one would show here.
  assert.equal(frame.shiftX, 0)
  assert.equal(frame.shiftY, 0)
})

test('typewriter reveals characters and toggles the caret', () => {
  const settings = core.normalizeSettings({ effect: 'typewriter', typeSpeedMs: 100, phrases: ['abcd'] })
  assert.deepEqual(core.effectFrame(settings, 0, '').text, 'a')
  assert.deepEqual(core.effectFrame(settings, 250, '').text, 'abc')
  assert.equal(core.effectFrame(settings, 250, '').caret, true)
  assert.deepEqual(core.effectFrame(settings, 800, '').text, 'abcd')
  assert.equal(core.effectFrame(settings, 800, '').caret, false)
})

test('the letterbox is gone: only four effects remain', () => {
  assert.deepEqual(core.EFFECTS, ['default', 'typewriter', 'terminal', 'decode'])
  for (const removed of ['fade', 'slide', 'wipe', 'blur', 'marquee']) {
    assert.equal(core.EFFECTS.includes(removed), false, removed + ' must be gone')
    assert.equal(core.normalizeSettings({ effect: removed }).effect, 'default', removed + ' must fall back')
  }
})

test('styles replace both the normal and shimmer copies of the label', () => {
  assert.match(core.STYLE_TEXT, /\[data-shimmer\] > span:first-child/)
  assert.match(core.STYLE_TEXT, /\[data-shimmer\]::before/)
  assert.match(core.STYLE_TEXT, /\[data-shimmer-text\]::after/)
  // The hidden stock line and the custom line share one grid cell, which is what
  // widens the box the clipped shimmer sweep travels in.
  assert.equal((core.STYLE_TEXT.match(/grid-area: 1 \/ 1/g) ?? []).length, 2)
  // No geometry baggage is left over from the removed effects.
  for (const gone of ['clip-path', 'filter: blur', 'translateX(var(--dsh-thinking-marquee']) {
    assert.equal(core.STYLE_TEXT.includes(gone), false, 'leftover CSS: ' + gone)
  }
})

test('duration extraction falls back to the visible label', () => {
  const fakeRoot = {
    querySelector: () => ({
      getAttribute: () => '深度求索中，用时 3 秒 ···',
    }),
  }
  assert.equal(core.readDurationFromElement(fakeRoot), '3 秒')
})

test('frame text lands on the shimmer root itself for attr()', () => {
  const shimmerAttributes = new Map()
  const labelAttributes = new Map()
  const styleProperties = new Map()
  const shimmer = {
    setAttribute: (key, value) => shimmerAttributes.set(key, value),
  }
  const label = {
    setAttribute: (key, value) => labelAttributes.set(key, value),
  }
  const element = {
    querySelector: (selector) => selector === '[data-shimmer]' ? shimmer : null,
    querySelectorAll: (selector) => selector === '[data-shimmer-text]' ? [label] : [],
    style: { setProperty: (key, value) => styleProperties.set(key, value) },
  }
  assert.equal(core.writeFrameToElement(element, {
    text: 'hello {duration}',
    opacity: 0.5,
    shiftX: 2,
    shiftY: 3,
    caret: true,
    effect: 'terminal',
  }), true)
  assert.equal(shimmerAttributes.get('data-dsh-thinking-phrase-text'), 'hello {duration}')
  assert.equal(shimmerAttributes.get('data-dsh-thinking-effect'), 'terminal', 'the effect attribute names the effect in force')
  assert.equal(labelAttributes.get('data-dsh-thinking-phrase-text'), 'hello {duration}')
  assert.equal(styleProperties.get('--dsh-thinking-opacity'), '0.5')
  assert.equal(styleProperties.get('--dsh-thinking-shift-x'), '2px')
  assert.equal(styleProperties.get('--dsh-thinking-caret-width'), '1px')
  // The removed effects left no variables behind.
  assert.equal(styleProperties.has('--dsh-thinking-wipe'), false)
  assert.equal(styleProperties.has('--dsh-thinking-blur'), false)
  assert.equal(styleProperties.has('--dsh-thinking-marquee'), false)
})

test('the configuration page sits on the plugin card, not in Settings', async () => {
  const registered = []
  const ctx = {
    locale: {
      register: () => () => {},
      translate: () => '',
      getLocale: () => ({ active: 'zh' }),
    },
    // The locale, style and clock effects need a real DOM and locale service;
    // this test only claims the seat the page registers.
    effect: () => {},
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  const warned = console.warn
  console.warn = () => {}
  try {
    core.apply(ctx)
    // The activation read is fire-and-forget; let its failure settle while the
    // warning for the absent host route stays muted.
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    console.warn = warned
  }

  const seats = registered.map((item) => item.options)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(seats.map((seat) => seat.name), ['plugins.bundle.config'])
  // The host dispatches this seat by the bundle's package name, and a mismatch
  // hides the configuration section silently.
  assert.equal(seats[0].key, pkg.name, '席位键应当是包名')
  assert.equal(typeof registered[0].component, 'function')
})

test('command-line effect types the phrase out behind a cursor', () => {
  const settings = core.normalizeSettings({ phrases: ['你好啊'], effect: 'terminal', typeSpeedMs: 50 })
  const frames = [0, 1, 2, 3].map((step) => core.effectFrame(settings, step * 50, '').text)
  assert.deepEqual(frames, ['_', '你_', '你好_', '你好啊'])
})

test('the browser and host effect lists agree', async () => {
  const { EFFECTS } = await import('../lib/store.js')
  // The host narrows a saved document to its own list: an effect missing there
  // would be written back as the default and silently undo the reader's choice.
  assert.deepEqual(core.EFFECTS, EFFECTS)
})

test('concurrent host reads share one request and a later mount reads again', async () => {
  const paths = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path) => {
    paths.push(path)
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: { phrases: ['来自宿主'], effect: 'terminal' } }),
    }
  }
  try {
    await Promise.all([core.loadFromHost(), core.loadFromHost()])
    assert.deepEqual(paths, ['/thinking-phrase/config'])
    await core.loadFromHost()
    assert.equal(paths.length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('random mode draws a phrase the previous step did not show', () => {
  // A draw that collides with the previous step re-draws from the phrases it left.
  const draws = [0.1, 0.1, 0.9]
  let cursor = 0
  const rng = () => draws[cursor++]
  const first = core.pickDifferentIndex(3, -1, rng)
  assert.equal(first, 0)
  assert.equal(core.pickDifferentIndex(3, first, rng), 2)
  assert.equal(core.pickDifferentIndex(1, 0, () => 0.9), 0)
  assert.equal(core.pickDifferentIndex(3, -1, () => 1), 2)
  // Two phrases always swap, and the collision costs exactly one more draw.
  let calls = 0
  assert.equal(core.pickDifferentIndex(2, 0, () => { calls += 1; return 0 }), 1)
  assert.equal(calls, 2)
  assert.equal(core.pickDifferentIndex(2, 1, () => 1), 0)
})

test('a collision leaves every remaining phrase equally likely', () => {
  // The grid divides evenly by every count under test, so the first draw is
  // exactly uniform and the only thing that can skew the totals is the re-draw.
  const grid = Array.from({ length: 60 }, (_, index) => index / 60)
  for (const count of [3, 4, 5]) {
    const previous = 1
    const hits = new Map()
    for (const first of grid) {
      for (const second of grid) {
        const draws = [first, second]
        let cursor = 0
        const index = core.pickDifferentIndex(count, previous, () => draws[cursor++])
        assert.notEqual(index, previous)
        assert.ok(index >= 0 && index < count, 'index in range: ' + index)
        hits.set(index, (hits.get(index) ?? 0) + 1)
      }
    }
    assert.deepEqual([...hits.values()], Array(count - 1).fill(3600 / (count - 1)))
  }
})

test('a rotation step draws once and holds its phrase for the whole dwell', () => {
  const state = { cycle: -1, randomIndex: -1 }
  let draws = 0
  const rng = () => {
    draws += 1
    // The draw never repeats: an implementation that re-drew until it differed
    // would spin here instead of failing, so it fails loudly.
    if (draws > 3) throw new Error('unexpected extra draw: ' + draws)
    return 0.6
  }
  assert.equal(core.randomStep(state, 3, 1000, 0, rng), true)
  assert.equal(draws, 1)
  assert.equal(state.randomIndex, 1)
  // Inside one dwell nothing is drawn again.
  assert.equal(core.randomStep(state, 3, 1000, 999, rng), false)
  assert.equal(draws, 1)
  assert.equal(state.randomIndex, 1)
  // The next step draws again -- twice here, because the first draw landed on
  // the phrase the previous step showed.
  assert.equal(core.randomStep(state, 3, 1000, 1000, rng), true)
  assert.equal(state.randomIndex, 0)
  assert.equal(draws, 3)
})

test('random mode shows the phrase the runtime picked', () => {
  const settings = core.normalizeSettings({
    phrases: ['first', 'second', 'third'],
    effect: 'default',
    random: true,
  })
  assert.equal(core.effectFrame(settings, 0, '', 2).text, 'third')
  // Without a pick -- the configuration page's preview -- the line rotates in order.
  assert.equal(core.effectFrame(settings, 0, '').text, 'first')
  assert.equal(core.effectFrame(settings, 4000, '').text, 'second')
})

test('the browser and host agree on defaults and normalization', async () => {
  const host = await import('../lib/store.js')
  // A field the host narrows away is a field a save silently drops.
  assert.deepEqual(core.DEFAULT_SETTINGS, host.DEFAULT_SETTINGS)
  const sample = {
    enabled: false,
    phrases: [' one ', '', 'two'],
    random: true,
    glitch: true,
    glitchChance: 40,
    effect: 'terminal',
    effectPool: ['decode', 'terminal'],
    randomEffect: true,
    decodeStyles: ['blocks', 'hex'],
    decodeSpeedMs: 90,
    cycleSeconds: 999,
    typeSpeedMs: -1,
  }
  assert.deepEqual(core.normalizeSettings(sample), host.normalizeSettings(sample))
  // The pool's own cleaning must match too: the sample above already happens to be
  // in canonical order, which would hide a divergence.
  const messy = { effectPool: ['decode', 'terminal', 'decode', 'nope', 42] }
  assert.deepEqual(core.cleanEffects(messy.effectPool), host.cleanEffects(messy.effectPool))
  assert.deepEqual(core.normalizeSettings(messy).effectPool, host.normalizeSettings(messy).effectPool)
  assert.deepEqual(core.cleanEffects(undefined), host.cleanEffects(undefined))
  assert.deepEqual(core.EFFECTS, host.EFFECTS)
  // The decode alphabet and style list are written twice; a split there would mean
  // the page offers a style the host silently renames on save.
  assert.deepEqual(core.DECODE_STYLES, host.DECODE_STYLES)
  // The style pick's cleaning is written twice as well.
  const styles = { decodeStyles: ['hex', 'blocks', 'hex', 'rainbow'] }
  assert.deepEqual(core.cleanDecodeStyles(styles.decodeStyles), host.cleanDecodeStyles(styles.decodeStyles))
  assert.deepEqual(core.normalizeSettings(styles).decodeStyles, host.normalizeSettings(styles).decodeStyles)
  // A document from before the pick still reads on both sides.
  assert.deepEqual(core.normalizeSettings({ decodeStyle: 'hex' }).decodeStyles, host.normalizeSettings({ decodeStyle: 'hex' }).decodeStyles)
  // An effect the host no longer lists must fall back on both sides.
  assert.equal(core.normalizeSettings({ effect: 'wipe' }).effect, host.normalizeSettings({ effect: 'wipe' }).effect)
})

test('placeholders fill from running time and the host duration', () => {
  assert.equal(core.durationSeconds('3 秒'), '3')
  assert.equal(core.durationSeconds('about 12s'), '12')
  assert.equal(core.durationSeconds(''), '0')
  assert.equal(core.durationSeconds(undefined), '0')
  assert.equal(core.renderText('{spinner}|{bar}|{seconds}|{duration}', 0, '3 秒'), '⠋|░░░░░░░░|0|3 秒')
  // The clock decides {seconds}; at three seconds it agrees with the host text.
  assert.equal(core.renderText('{seconds}|{duration}', 3000, '3 秒'), '3|3 秒')
})

test('{seconds} counts the clock, not the first number the host text leads with', () => {
  // Past a minute the host text leads with minutes: parsing it would report 1
  // second for a 65 second run.
  assert.equal(core.durationSeconds('1 分 5 秒', 65000), '65')
  assert.equal(core.durationSeconds('1 小时 2 分 5 秒', 3725000), '3725')
  assert.equal(core.renderText('思考 {seconds} 秒', 90000, '1 分 30 秒'), '思考 90 秒')
  assert.equal(core.renderText('{seconds}', 0, '0 秒'), '0')
  // Without a clock it can only fall back to the text.
  assert.equal(core.durationSeconds('1 分 5 秒'), '1')
})

test('the spinner cycles through its frames', () => {
  assert.equal(core.spinnerFrame(0), '⠋')
  assert.equal(core.spinnerFrame(99), '⠋')
  assert.equal(core.spinnerFrame(100), '⠙')
  // One full turn back to the first frame.
  assert.equal(core.spinnerFrame(1000), '⠋')
})

test('the bar fills one cell per second and holds full', () => {
  assert.equal(core.barFrame(0), '░░░░░░░░')
  assert.equal(core.barFrame(3000), '███░░░░░')
  assert.equal(core.barFrame(8000), '████████')
  assert.equal(core.barFrame(600000), '████████')
  assert.equal(core.barFrame(-5), '░░░░░░░░')
  assert.equal(core.barFrame(2000, 4), '██░░')
})

test('the typo draw follows the configured chance', () => {
  assert.equal(core.shouldGlitch(1, 0), false)
  assert.equal(core.shouldGlitch(1, 100), true)
  assert.equal(core.shouldGlitch(1, 150), true)
  assert.equal(core.shouldGlitch(1, -20), false)
  // A third of the events at 33 percent, within sampling noise.
  let hits = 0
  for (let seed = 1; seed <= 900; seed += 1) {
    if (core.shouldGlitch(seed, 33)) hits += 1
  }
  assert.ok(hits > 200 && hits < 400, 'hits out of range at 33%: ' + hits)
  // The same event always answers alike, so a later tick cannot flip it.
  assert.equal(core.shouldGlitch(7, 33), core.shouldGlitch(7, 33))
})

test('the very first observation only records the baseline', () => {
  const state = { ready: false, reveal: null, step: 0, glitch: null }
  // Nothing has been observed, so nothing can be corrected yet -- even at 100%.
  assert.equal(core.advanceGlitch(state, 0, 1, 12, 0, 100), null)
  assert.equal(state.glitch, null)
})

test('typing reports one arrival per glyph', () => {
  const typing = core.normalizeSettings({ phrases: ['你好啊'], effect: 'typewriter', typeSpeedMs: 100 })
  // Typewriter shows the first glyph immediately, then one per interval.
  assert.equal(core.typingCount(typing, '你好啊', 0), 1)
  assert.equal(core.typingCount(typing, '你好啊', 100), 2)
  assert.equal(core.typingCount(typing, '你好啊', 999), 3)
  assert.equal(core.typingCount(typing, '你好啊', 5000), 3)
  const terminal = core.normalizeSettings({ phrases: ['你好啊'], effect: 'terminal', typeSpeedMs: 100 })
  assert.equal(core.typingCount(terminal, '你好啊', 0), 0)
  assert.equal(core.typingCount(terminal, '你好啊', 100), 1)
  // A line that appears whole raises no arrival at all.
  const stat = core.normalizeSettings({ phrases: ['你好啊'], effect: 'default' })
  assert.equal(core.typingCount(stat, '你好啊', 0), 3)
  assert.equal(core.typingProgress(stat, 5000), null)
})

test('a flicker starts on a revealed glyph and holds it', () => {
  const state = { ready: false, reveal: null, step: 0, glitch: null }
  assert.equal(core.advanceGlitch(state, 0, 1, 12, 0, 100), null)
  // The next glyph the clock reveals is the one that comes out wrong.
  assert.deepEqual(core.advanceGlitch(state, 100, 2, 12, 0, 100), { index: 1, since: 100, seed: 2 })
  // No new glyph: the same typo holds, it is not drawn again.
  assert.deepEqual(core.advanceGlitch(state, 150, 2, 12, 0, 100), { index: 1, since: 100, seed: 2 })
  // Once its window closes, nothing is left to show.
  assert.equal(core.advanceGlitch(state, 260, 2, 12, 0, 100), null)
  // A zero chance keeps every event clean.
  const quiet = { ready: false, reveal: null, step: 0, glitch: null }
  core.advanceGlitch(quiet, 0, 1, 12, 0, 0)
  assert.equal(core.advanceGlitch(quiet, 100, 2, 12, 0, 0), null)
})

test('a growing placeholder is not a glyph arriving', () => {
  // 9 秒 -> 10 秒 adds a code point, but the typing clock is long past the line.
  const state = { ready: false, reveal: null, step: 0, glitch: null }
  core.advanceGlitch(state, 0, 1, 6, 0, 100)
  state.reveal = 199
  assert.equal(
    core.advanceGlitch(state, 10000, 200, 7, 0, 100),
    null,
    'a wider duration must not spoil a line that is already correct',
  )
})

test('the draw belongs to this turn, not to the phrase', () => {
  // The same phrase in different turns must not answer alike, or one phrase
  // would flicker every single time it comes round.
  for (const seedOf of [(step) => step * 977 + 13, (step) => step * 131 + 2]) {
    const answers = new Set()
    for (let step = 1; step <= 40; step += 1) answers.add(core.shouldGlitch(seedOf(step), 40))
    assert.deepEqual([...answers].sort(), [false, true], 'both outcomes must occur')
  }
})

test('a switch ends the typo the previous phrase was showing', () => {
  const state = { ready: false, reveal: null, step: 0, glitch: null }
  core.advanceGlitch(state, 0, null, 12, 0, 100)
  const typo = core.advanceGlitch(state, 100, null, 12, 1, 100)
  assert.ok(typo !== null, 'the switch itself flickers at 100%')
  assert.equal(state.glitch, typo)
  // The next switch draws nothing, and still leaves no typo behind.
  assert.equal(core.advanceGlitch(state, 200, null, 12, 2, 0), null)
  assert.equal(state.glitch, null, 'no typo may drift into the next phrase')
})

test('a flicker keeps the length, the first glyph and a reserved tail', () => {
  const original = '深度求索中，用时 3 秒'
  const clean = [...original]
  // The arriving glyph is the only one spoiled, and never the head.
  const arriving = core.glitchText(original, 4, 9, 0)
  const changed = [...arriving].map((c, i) => (c === clean[i] ? -1 : i)).filter((i) => i >= 0)
  assert.deepEqual(changed, [4])
  assert.equal(Array.from(arriving).length, clean.length)
  // The head stays readable whatever the index.
  assert.deepEqual([...core.glitchText(original, 0, 9, 0)], clean)
  // A reserved tail is never spoiled.
  assert.equal([...core.glitchText('深度求索中_', -1, 9, 1)].pop(), '_')
  // The last spoilable position, with the cursor one place further on.
  assert.equal([...core.glitchText('你好_', 1, 9, 1)].pop(), '_')
  assert.equal([...core.glitchText('你好_', 2, 9, 1)].pop(), '_')
  // A switched-in phrase spoils two glyphs, never the head.
  for (let seed = 1; seed < 40; seed += 1) {
    const spoiled = [...core.glitchText(original, -1, seed, 0)]
    const hits = spoiled.map((c, i) => (c === clean[i] ? -1 : i)).filter((i) => i >= 0)
    assert.equal(hits.length, 2, 'seed ' + seed + ' spoiled ' + hits.length)
    assert.ok(!hits.includes(0), 'seed ' + seed + ' spoiled the head')
  }
  // Too short to spoil.
  assert.equal(core.glitchText('a', -1, 9, 0), 'a')
  assert.equal(core.glitchText('', -1, 9, 0), '')
})

test('the try-it press forces one flicker', () => {
  const pressed = core.probeGlitch({ current: Date.now() - 30 }, 0)
  assert.ok(pressed !== null, 'a fresh press must flicker')
  assert.equal(pressed.index, -1)
  // Two presses spoil different glyphs.
  const again = core.probeGlitch({ current: Date.now() - 120 }, 0)
  assert.notEqual(again.seed, pressed.seed)
  assert.equal(core.probeGlitch({ current: 0 }, 0), null)
  assert.equal(core.probeGlitch(undefined, 0), null)
  // Long after the press the flicker is over.
  assert.equal(core.probeGlitch({ current: Date.now() - 5000 }, 0), null)
  // It reaches the frame even while the switch is off.
  const off = core.normalizeSettings({ phrases: ['深度求索中，用时 {duration}'], effect: 'default' })
  const quiet = core.effectFrame(off, 0, '3 秒').text
  const forced = core.effectFrame(off, 0, '3 秒', undefined, pressed).text
  assert.notEqual(forced, quiet)
  assert.equal(Array.from(forced).length, Array.from(quiet).length)
})

test('a flicker corrects itself after its window', () => {
  const settings = core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'],
    effect: 'default',
    glitch: true,
    glitchChance: 100,
  })
  const flicker = { index: -1, since: 100, seed: 3 }
  const during = core.effectFrame(settings, 100, '3 秒', undefined, flicker).text
  const held = core.effectFrame(settings, 100 + 159, '3 秒', undefined, flicker).text
  const corrected = core.effectFrame(settings, 100 + 160, '3 秒', undefined, flicker).text
  assert.notEqual(during, core.effectFrame(settings, 100, '3 秒').text)
  assert.equal(held, during)
  assert.equal(corrected, core.effectFrame(settings, 260, '3 秒').text)
})

test('the preview restarts when the typo settings move', () => {
  const base = core.normalizeSettings({ phrases: ['深度求索中，用时 {duration}'], effect: 'default' })
  const still = core.previewKey(base, '3 秒')
  const enabled = core.previewKey(core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'], effect: 'default', glitch: true,
  }), '3 秒')
  const chance = core.previewKey(core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'], effect: 'default', glitch: true, glitchChance: 60,
  }), '3 秒')
  assert.notEqual(enabled, still)
  assert.notEqual(chance, enabled)
  // The effect pool and its switch belong in the key: changing either must restart
  // the preview, or it would keep drawing from the previous pool.
  const pooled = core.previewKey(core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'], effect: 'default', effectPool: ['wipe', 'decode'],
  }), '3 秒')
  const pooledOn = core.previewKey(core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'], effect: 'default', effectPool: ['wipe', 'decode'], randomEffect: true,
  }), '3 秒')
  const otherPool = core.previewKey(core.normalizeSettings({
    phrases: ['深度求索中，用时 {duration}'], effect: 'default', effectPool: ['wipe', 'marquee'], randomEffect: true,
  }), '3 秒')
  assert.notEqual(pooled, still)
  assert.notEqual(pooledOn, pooled)
  assert.notEqual(otherPool, pooledOn)
  assert.equal(core.previewKey(base, '3 秒'), still)
})

test('the decode effect settles out of order, a glyph at a time', () => {
  const phrase = '深度求索中，用时三秒'
  const total = [...phrase].length
  assert.equal([...core.decodeText(phrase, 0)].length, total)

  // Midway, some positions have settled and most have not -- and the settled ones
  // are not a prefix, which is what separates a decode from a typewriter.
  const midway = [...core.decodeText(phrase, 5 * core.DEFAULT_DECODE_SPEED_MS)]
  const flags = midway.map((glyph, at) => glyph === [...phrase][at])
  const settledNow = flags.filter(Boolean).length
  assert.ok(settledNow > 0 && settledNow < total, 'partial settle expected, got ' + settledNow)
  assert.ok(flags.some((settled, at) => settled && at > 0), 'a later position must settle')
  assert.ok(flags.some((settled, at) => !settled && at < total - 1), 'an earlier position must stay noise')
  const lastSettled = flags.lastIndexOf(true)
  const firstNoise = flags.indexOf(false)
  assert.ok(firstNoise < lastSettled, 'the settled set must not be a prefix')

  // Long enough and the whole line is real text again.
  assert.equal(core.decodeText(phrase, core.DEFAULT_DECODE_SPEED_MS * total), phrase)
  // Spaces stay spaces, so word breaks never turn into noise.
  const spaced = core.decodeText('a b', 0)
  assert.equal(spaced[1], ' ')
  assert.equal([...spaced].length, 3)
})

test('a decode glyph fades through its stages before it settles', () => {
  const phrase = '深度求索中，用时三秒'
  const stageOf = new Set()
  const firstGlyphStages = []
  for (let step = 0; step <= [...phrase].length; step += 1) {
    const frame = [...core.decodeText(phrase, step * core.DEFAULT_DECODE_SPEED_MS)]
    firstGlyphStages.push(frame[1])
    stageOf.add(core.DECODE_STAGES.findIndex((palette) => palette.includes(frame[1])))
  }
  // A position walks from the coarse palette to the real glyph, not straight there.
  const distinct = [...new Set(firstGlyphStages.filter((glyph) => glyph !== '度'))]
  assert.ok(distinct.length >= 2, 'expected at least two noise stages, got ' + distinct.join(''))
  // Every noise stage is drawn from a known palette.
  for (const glyph of firstGlyphStages) {
    const known = glyph === '度' || core.DECODE_STAGES.some((palette) => palette.includes(glyph))
    assert.ok(known, 'unknown decode glyph: ' + glyph)
  }
})

test('a salt changes the decode order, and the same salt repeats it', () => {
  const phrase = '深度求索中，用时三秒'
  const at = core.decodeText(phrase, 3 * core.DEFAULT_DECODE_SPEED_MS, 7)
  assert.equal(at, core.decodeText(phrase, 3 * core.DEFAULT_DECODE_SPEED_MS, 7))
  const orders = new Set()
  for (let salt = 0; salt < 12; salt += 1) orders.add(core.decodeText(phrase, 3 * core.DEFAULT_DECODE_SPEED_MS, salt))
  assert.ok(orders.size > 1, 'different salts must decode differently')
})

test('the phrase cap is 25 and the page counts what is typed', () => {
  assert.equal(core.MAX_PHRASES, 25)
  const many = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
  assert.equal(core.phrasesFromTextarea(many.join('\n')).length, core.MAX_PHRASES)
  // The count is of the textarea, so blank lines do not inflate it and going past
  // the cap is visible rather than silently trimmed.
  assert.equal(core.countPhrases('a\n\n  \nb\n'), 2)
  assert.equal(core.countPhrases(''), 0)
  assert.equal(core.countPhrases(undefined), 0)
  assert.equal(core.countPhrases(many.join('\n')), 40)
  // Both halves store the same cap, or a save would quietly truncate.
  return import('../lib/store.js').then((host) => {
    assert.equal(core.MAX_PHRASES, host.MAX_PHRASES)
    assert.equal(core.MAX_PHRASE_LENGTH, host.MAX_PHRASE_LENGTH)
  })
})

test('a decode style pick never ends up empty, and a dead click leaves the draft alone', () => {
  // The page refuses to un-tick the last style. `cleanDecodeStyles` is the backstop
  // for anything that gets past the page, such as a hand-edited document.
  const empty = core.normalizeSettings({ effect: 'decode', decodeStyles: [] })
  assert.deepEqual(empty.decodeStyles, ['blocks'])
  const nulled = core.normalizeSettings({ decodeStyles: null })
  assert.deepEqual(nulled.decodeStyles, ['blocks'])
  assert.deepEqual(core.normalizeSettings({ decodeStyles: ['hex', 'rainbow'] }).decodeStyles, ['hex'])
  // Both halves must agree on the fallback, or a save would rewrite the pick.
  return import('../lib/store.js').then((host) => {
    assert.deepEqual(core.normalizeSettings({ decodeStyles: [] }).decodeStyles, host.normalizeSettings({ decodeStyles: [] }).decodeStyles)
    assert.deepEqual(core.normalizeSettings({ decodeStyles: null }).decodeStyles, host.normalizeSettings({ decodeStyles: null }).decodeStyles)
  })
})

test('every decode noise glyph is full width, so the line never widens', () => {
  // An equal-width CJK font advances ambiguous glyphs (U+2588 shading blocks and
  // friends) by half a CJK cell, which made a settling line creep wider. Every
  // noise glyph must occupy the same cell as the character it replaces.
  for (const glyph of core.DECODE_STAGES.flat()) {
    assert.ok(core.isFullWidthGlyph(glyph), 'not a full-width glyph: ' + glyph)
  }
  for (const glyph of core.DECODE_HEX) {
    assert.ok(core.isFullWidthGlyph(glyph), 'not a full-width glyph: ' + glyph)
  }
  assert.equal(core.DECODE_HEX.length, 16)
})

test('the decode style picks shading symbols or hex data', () => {
  const phrase = '深度求索中，用时三秒'
  const blocks = core.decodeText(phrase, 0, 0, 40, 'blocks')
  const hex = core.decodeText(phrase, 0, 0, 40, 'hex')
  assert.notEqual(blocks, hex)
  const hexAlpha = new Set(core.DECODE_HEX)
  for (const glyph of hex) {
    if (glyph === ' ' || [...phrase].includes(glyph)) continue
    assert.ok(hexAlpha.has(glyph), 'hex noise must stay in 0-9A-F: ' + glyph)
  }
  for (const glyph of blocks) {
    if (glyph === ' ' || [...phrase].includes(glyph)) continue
    assert.ok(core.DECODE_STAGES.some((palette) => palette.includes(glyph)), 'symbol noise must stay in its palette: ' + glyph)
  }
  // Both styles settle to the same real line.
  assert.equal(core.decodeText(phrase, 40 * [...phrase].length, 0, 40, 'hex'), phrase)
})

test('the decode speed sets how fast glyphs settle', () => {
  const phrase = '深度求索中，用时三秒'
  const total = [...phrase].length
  const fast = core.decodeText(phrase, 200, 0, 10, 'blocks')
  const slow = core.decodeText(phrase, 200, 0, 200, 'blocks')
  const settledOnes = (text) => [...text].filter((glyph, at) => glyph === [...phrase][at]).length
  assert.ok(settledOnes(fast) > settledOnes(slow), 'a smaller step must settle more glyphs')
  // A speed out of range is pulled back to what the host would store.
  const settings = core.normalizeSettings({ phrases: [phrase], effect: 'decode', decodeSpeedMs: 1 })
  assert.equal(settings.decodeSpeedMs, 10)
  assert.equal(
    core.effectFrame(settings, 400, '3 秒', undefined, null, { effect: 'decode', salt: 1 }).text,
    core.decodeText(core.renderText(phrase, 400, '3 秒'), 400, 1, 10, 'blocks'),
  )
  assert.ok(total > 0)
})

test('the two noise effects keep different glyph sets', () => {
  const decodeGlyphs = new Set(core.DECODE_STAGES.flat())
  const typo = core.glitchText('深度求索中，用时三秒', -1, 5, 0)
  const spoiled = [...typo].filter((glyph, at) => glyph !== [...'深度求索中，用时三秒'][at])
  assert.ok(spoiled.length > 0)
  for (const glyph of spoiled) assert.ok(!decodeGlyphs.has(glyph), 'a typo must not borrow a decode glyph: ' + glyph)
})

test('a decode never raises an automatic typo', () => {
  assert.equal(core.glitchAllowed('decode'), false)
  for (const effect of core.EFFECTS) {
    if (effect !== 'decode') assert.equal(core.glitchAllowed(effect), true, effect)
  }
  // The manual "try it" press still reaches a decode frame.
  const settings = core.normalizeSettings({ phrases: ['深度求索中，用时 {duration}'], effect: 'decode' })
  const plain = core.effectFrame(settings, 5000, '3 秒', undefined, null, { effect: 'decode' }).text
  const pressed = core.effectFrame(settings, 5000, '3 秒', undefined, { index: -1, since: 5000, seed: 9 }, { effect: 'decode' }).text
  assert.notEqual(pressed, plain)
})

test('a pool draws a chosen effect per step, and never leaves the pool', () => {
  const settings = core.normalizeSettings({
    phrases: ['a', 'b'],
    effect: 'terminal',
    effectPool: ['decode', 'typewriter', 'terminal'],
    randomEffect: true,
  })
  const seen = new Set()
  for (let step = 1; step < 40; step += 1) {
    const picked = core.resolveEffect(settings, step, 0)
    assert.ok(['decode', 'typewriter', 'terminal'].includes(picked), 'picked outside the pool: ' + picked)
    seen.add(picked)
  }
  assert.equal(seen.size, 3, 'every pooled effect should come up: ' + [...seen].join(','))
  // The same step always answers alike, so an effect does not flicker mid-phrase.
  assert.equal(core.resolveEffect(settings, 7, 0), core.resolveEffect(settings, 7, 0))

  // Switch off, or an empty pool: the fixed effect wins.
  const fixed = core.normalizeSettings({ phrases: ['a'], effect: 'terminal', effectPool: ['decode'], randomEffect: false })
  assert.equal(core.resolveEffect(fixed, 5, 0), 'terminal')
  const empty = core.normalizeSettings({ phrases: ['a'], effect: 'decode', randomEffect: true })
  assert.equal(core.resolveEffect(empty, 5, 0), 'decode')
})

test('a pool draw differs per label but holds within one', () => {
  const settings = core.normalizeSettings({
    phrases: ['a', 'b'],
    effect: 'terminal',
    effectPool: ['decode', 'typewriter', 'terminal', 'default'],
    randomEffect: true,
  })
  const firstOfLabel = new Set()
  for (let salt = 1; salt <= 24; salt += 1) firstOfLabel.add(core.resolveEffect(settings, 0, 0, salt))
  // Without a salt every label would open with the same effect.
  assert.ok(firstOfLabel.size > 1, 'labels must not all start identically')
  assert.equal(core.resolveEffect(settings, 0, 0, 5), core.resolveEffect(settings, 0, 0, 5))
  // A salt never pushes the draw outside the pool.
  for (let salt = 0; salt < 30; salt += 1) {
    for (let step = 0; step < 12; step += 1) {
      assert.ok(['decode', 'typewriter', 'terminal', 'default'].includes(core.resolveEffect(settings, step, 0, salt)))
    }
  }
})

test('two ticked decode styles are drawn per switch, one is fixed', () => {
  const both = core.normalizeSettings({ phrases: ['a', 'b'], effect: 'decode', decodeStyles: ['blocks', 'hex'] })
  const seen = new Set()
  for (let step = 1; step < 40; step += 1) seen.add(core.resolveDecodeStyle(both, step, 0, 1))
  assert.deepEqual([...seen].sort(), ['blocks', 'hex'], 'both ticked styles should come up')
  // One step never changes its look, whatever the tick.
  assert.equal(core.resolveDecodeStyle(both, 7, 0, 1), core.resolveDecodeStyle(both, 7, 0, 1))
  // A different label seed opens differently.
  const openings = new Set()
  for (let salt = 1; salt <= 20; salt += 1) openings.add(core.resolveDecodeStyle(both, 0, 0, salt))
  assert.equal(openings.size, 2, 'a new label may open with either style')

  // A single tick is simply that style.
  const single = core.normalizeSettings({ effect: 'decode', decodeStyles: ['hex'] })
  for (let step = 0; step < 20; step += 1) assert.equal(core.resolveDecodeStyle(single, step, 0, 3), 'hex')
  // An empty pick still has a look, and the frames follow the picked style.
  const empty = core.normalizeSettings({ effect: 'decode', decodeStyles: [] })
  assert.equal(core.resolveDecodeStyle(empty, 0, 0, 0), 'blocks')

  const styled = core.normalizeSettings({ phrases: ['深度求索中'], effect: 'decode', decodeStyles: ['hex'] })
  const frame = core.effectFrame(styled, 0, '3 秒', undefined, null, { effect: 'decode', salt: 2 }).text
  assert.equal(frame, core.decodeText('深度求索中', 0, 2, styled.decodeSpeedMs, 'hex'))
})

test('the decode speed is clamped the same way the settings are', () => {
  const phrase = '深度求索中，用时三秒'
  // Out-of-range input is pulled into 10-300 rather than trusted: 0 behaves like
  // 10, a huge value like 300, and a missing one like the default.
  assert.equal(core.decodeText(phrase, 100, 0, 0, 'blocks'), core.decodeText(phrase, 100, 0, 10, 'blocks'))
  assert.equal(core.decodeText(phrase, 100, 0, 9999, 'blocks'), core.decodeText(phrase, 100, 0, 300, 'blocks'))
  assert.equal(core.decodeText(phrase, 100, 0, undefined, 'blocks'), core.decodeText(phrase, 100, 0, core.DEFAULT_DECODE_SPEED_MS, 'blocks'))
  assert.equal(core.decodeText(phrase, 100, 0, NaN, 'blocks'), core.decodeText(phrase, 100, 0, core.DEFAULT_DECODE_SPEED_MS, 'blocks'))
})

test('the effect in force decides which controls the page shows', () => {
  // A pool with entries is what a step can land on; without one the fixed effect is.
  assert.deepEqual(core.activeEffects(core.normalizeSettings({ effect: 'decode' })), ['decode'])
  assert.deepEqual(
    core.activeEffects(core.normalizeSettings({ effect: 'default', effectPool: ['terminal', 'decode'], randomEffect: true })),
    ['terminal', 'decode'],
  )
  // The switch is on but nothing is ticked: the fixed effect still runs, so its
  // controls must still show.
  assert.deepEqual(
    core.activeEffects(core.normalizeSettings({ effect: 'decode', effectPool: [], randomEffect: true })),
    ['decode'],
  )
  // The switch is off: the pool is ignored even when it is full.
  assert.deepEqual(
    core.activeEffects(core.normalizeSettings({ effect: 'default', effectPool: ['decode'], randomEffect: false })),
    ['default'],
  )
})

test('every effect keeps the full line once it has finished arriving', () => {
  const phrase = '深度求索中，用时 {duration}'
  const expected = Array.from('深度求索中，用时 3 秒').length
  for (const effect of core.EFFECTS) {
    const settings = core.normalizeSettings({ phrases: [phrase], effect, typeSpeedMs: 10 })
    // Far past every arrival and every decode step, so only the full line remains.
    const settled = core.effectFrame(settings, 60000, '3 秒', undefined, null, { effect })
    assert.equal(settled.effect, effect, effect + ' did not report its own effect')
    assert.equal(Array.from(settled.text).length, expected, effect + ' lost part of the line')
    assert.ok(settled.opacity >= 0 && settled.opacity <= 1, effect + ' opacity out of range')
    assert.equal(typeof settled.caret, 'boolean', effect + ' caret must be a boolean')
  }
  // Typewriter really does type, so at the very first frame it shows one glyph.
  const typing = core.normalizeSettings({ phrases: [phrase], effect: 'typewriter', typeSpeedMs: 100 })
  assert.equal(Array.from(core.effectFrame(typing, 0, '3 秒', undefined, null, { effect: 'typewriter' }).text).length, 1)
})

test('every copy key the page asks for exists in both dictionaries', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const asked = new Set()
  // A key may be called with interpolation arguments, so the closing delimiter is
  // either `)` or a comma.
  for (const match of source.matchAll(/(?:\bt|\bsay)\('([a-zA-Z]+\.[a-zA-Z]+)'\s*[,)]/g)) asked.add(match[1])
  // Keys built by concatenation (`t('decodeStyle.' + id)`) never match the literal
  // pattern, so the prefix is read too and expanded from the list it iterates.
  const prefixes = new Set()
  for (const match of source.matchAll(/(?:\bt|\bsay)\('([a-zA-Z]+\.)'\s*\+/g)) prefixes.add(match[1])
  assert.ok(prefixes.has('effect.'), 'the effect chips build their key from a prefix')
  assert.ok(prefixes.has('decodeStyle.'), 'the decode style chips build their key from a prefix')
  for (const effect of core.EFFECTS) asked.add('effect.' + effect)
  for (const style of core.DECODE_STYLES) asked.add('decodeStyle.' + style)
  assert.ok(asked.size > 18, '应当解析出足够多的文案键，实际 ' + asked.size)
  for (const key of asked) {
    assert.equal(typeof core.COPY.en[key], 'string', 'en 缺少文案键：' + key)
    assert.equal(typeof core.COPY.zh[key], 'string', 'zh 缺少文案键：' + key)
  }
  assert.deepEqual(
    Object.keys(core.COPY.zh).sort(),
    Object.keys(core.COPY.en).sort(),
    '两份字典的键应当一致',
  )
  // A removed effect leaves no dead copy behind.
  for (const gone of ['fade', 'slide', 'wipe', 'blur', 'marquee']) {
    assert.equal(core.COPY.zh['effect.' + gone], undefined, 'orphan zh key: effect.' + gone)
    assert.equal(core.COPY.en['effect.' + gone], undefined, 'orphan en key: effect.' + gone)
  }
  assert.equal(core.COPY.zh['form.marqueeHint'], undefined, 'orphan marquee hint')
})

test('the phrase counter renders its numbers, not its placeholders', () => {
  // The counter is the one place a placeholder is filled for the reader; a typo in
  // `{count}`/`{max}` would show raw braces and no test would notice.
  for (const table of [core.COPY.zh, core.COPY.en]) {
    const count = table['form.phrasesCount']
    const over = table['form.phrasesOver']
    assert.ok(count.includes('{count}') && count.includes('{max}'), 'count copy lost a placeholder: ' + count)
    assert.ok(over.includes('{count}') && over.includes('{max}'), 'over copy lost a placeholder: ' + over)
    // Fill it the way the page does and check no braces survive.
    const filled = count.split('{count}').join('10').split('{max}').join('25')
    const filledOver = over.split('{count}').join('30').split('{max}').join('25')
    assert.equal(filled.includes('{'), false, 'unfilled placeholder: ' + filled)
    assert.equal(filledOver.includes('{'), false, 'unfilled placeholder: ' + filledOver)
    assert.ok(filled.includes('10') && filled.includes('25'), 'count copy lost its numbers: ' + filled)
    assert.ok(filledOver.includes('30') && filledOver.includes('25'), 'over copy lost its numbers: ' + filledOver)
  }
})
