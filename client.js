// dsh-thinking-phrase — browser half.
//
// DSH's running status ("深度求索中，用时 3 秒 ···") is rendered by
// dsh-client-ui-chat's RunningStatus through TextShimmer.  The host exposes no
// slot for that one line, so this plugin leaves the React tree alone and
// rewrites the generated content of TextShimmer's `data-shimmer-text`
// pseudo-element.  That keeps the original layout, font and blue colour while
// letting us drive the text and a 50ms animation clock ourselves.
//
// A host route stores the preference document beside the other DSH user data;
// localStorage is the fallback for a host that has not loaded the route yet.
window.__ModuleLoader__.load({
  id: 'dsh-thinking-phrase',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useState = React.useState

    var PACKAGE_NAME = 'dsh-thinking-phrase'
    var NS = 'thinkingPhrase'
    var CONFIG_ROUTE = '/thinking-phrase/config'
    var SAVE_ROUTE = '/thinking-phrase/save'
    var MARKER = 'x-dsh-thinking-phrase'
    var STORAGE_KEY = 'dsh-thinking-phrase' + '.settings.v1'
    var STYLE_ID = 'dsh-thinking-phrase-style'
    var REQUEST_TIMEOUT_MS = 4_000
    var SAVE_TIMEOUT_MS = 8_000
    var TICK_MS = 50

    var EFFECTS = ['default', 'typewriter', 'terminal', 'decode']
    /** The command-line effect's cursor: the text types out behind this glyph. */
    var TERMINAL_CURSOR = '_'
    /**
     * Decode: one more glyph settles somewhere in the line every this many
     * milliseconds, by default. The order is scattered, so the line never resolves
     * as a prefix the way a typewriter does.
     */
    var DEFAULT_DECODE_SPEED_MS = 40
    /**
     * Decode looks like full-width symbols, or like raw hex data.
     */
    var DECODE_STYLES = ['blocks', 'hex']
    /**
     * The symbol style's three fading stages, coarse to fine, so a glyph is
     * visibly being resolved rather than flashed. Every glyph here is East Asian
     * full width: the shading blocks this used to draw (U+2588 and friends) are
     * "ambiguous" width, so an equal-width font advanced them by half a CJK glyph
     * and the line visibly widened as each glyph settled.
     */
    var DECODE_STAGES = [
      ['〓', '＃', '＠'],
      ['＊', '＋', '〇'],
      ['・', '。', '：'],
    ]
    /**
     * The hex style's alphabet, which reads as bytes being parsed. Full-width
     * forms, so a hex glyph occupies the same advance as a CJK one and the line
     * does not visibly widen as glyphs settle.
     */
    var DECODE_HEX = '０１２３４５６７８９ＡＢＣＤＥＦ'
    /**
     * A typo shows punctuation, never a full-width symbol a decode draws: the two
     * effects must not read as the same noise.
     */
    var GLITCH_GLYPHS = ['#', '%', '&', '@', '*', '+', '=', '?']

    // ── text placeholders a phrase may carry ──────────────────────────────
    /** Braille spinner, one frame per `SPINNER_FRAME_MS` of running time. */
    var SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    var SPINNER_FRAME_MS = 100
    /** `{bar}`: one block per second, capped so the bar never outgrows the line. */
    var BAR_CELLS = 8
    var BAR_CELL_MS = 1000
    var BAR_FILLED = '█'
    var BAR_EMPTY = '░'

    // ── glitch flicker ────────────────────────────────────────────────────
    // Event-driven, not clock-driven: only a glyph that just arrived, or a phrase
    // that just switched in, may flicker -- a correction you might believe. Every
    // event draws against a configurable chance, so most events stay clean. The
    // draw is a hash of the event, so it is reproducible and testable.
    /** How long a wrong glyph shows before it corrects itself. */
    var GLITCH_FIX_MS = 160
    /** Default share of events that flicker, in percent. */
    var GLITCH_CHANCE = 35

    var DEFAULT_SETTINGS = Object.freeze({
      enabled: true,
      phrases: Object.freeze(['深度求索中，用时 {duration}']),
      random: false,
      glitch: false,
      glitchChance: GLITCH_CHANCE,
      effect: 'default',
      effectPool: Object.freeze([]),
      randomEffect: false,
      decodeStyles: Object.freeze(['blocks']),
      decodeSpeedMs: DEFAULT_DECODE_SPEED_MS,
      cycleSeconds: 4,
      typeSpeedMs: 45,
    })

    // ── copy ───────────────────────────────────────────────────────────────
    var en = {
      'page.title': 'Thinking phrase',
      'page.intro': 'The line Chat shows while the model is thinking: its text, its effect and its rhythm.',
      'effect.default': 'Default',
      'effect.typewriter': 'Typewriter',
      'effect.terminal': 'Command line',
      'effect.decode': 'Decode',
      'decodeStyle.blocks': 'Symbols',
      'decodeStyle.hex': 'Hex data',
      'form.decodeStyle': 'Decode noise (tick one or both)',
      'form.decodeStyleHint': 'Tick both to draw one at random on each switch; at least one stays ticked.',
      'form.decodeSpeed': 'Decode speed',
      'form.decodeSpeedUnit': 'ms per glyph',
      'form.enabled': 'Show this phrase while the model is thinking',
      'form.phrases': 'Phrases (one per line; several lines rotate)',
      'form.phrasesPlaceholder': 'Deep diving for {duration}\nThinking hard…',
      'form.phrasesHint': 'Up to {max} lines. Placeholders: {duration} localized elapsed, {seconds} plain seconds, {spinner} a turning mark, {bar} a bar filling with the whole running time.',
      'form.phrasesCount': '{count}/{max}',
      'form.phrasesOver': '{count}/{max} -- only the first {max} are kept',
      'form.random': 'Pick the next phrase at random',
      'form.randomHint': 'Random order instead of cycling in sequence; needs more than one phrase, and the preview still cycles in order.',
      'form.glitch': 'Occasional typo that corrects itself',
      'form.glitchHint': 'Only a glyph that just appeared, or a phrase that just switched in, may come out wrong for a moment.',
      'form.glitchChance': 'Chance',
      'form.glitchTry': 'Try it',
      'form.randomEffect': 'Pick an effect at random for each phrase',
      'form.randomEffectHint': 'Every step that switches a phrase draws one of the effects you tick below.',
      'form.effectPool': 'Effects to draw from',
      'form.effectPoolHint': 'Tick two or more; a single tick just keeps that effect.',
      'form.effectPoolEmpty': 'Nothing ticked yet: the fixed effect above still applies.',
      'form.effect': 'Effect',
      'form.cycle': 'Each phrase lasts',
      'form.seconds': 'seconds',
      'form.typeSpeed': 'Typing speed',
      'form.msPerChar': 'ms per character',
      'form.preview': 'Preview',
      'form.previewEmpty': '(no phrase)',
      'form.previewDuration': '3s',
      'form.save': 'Save',
      'form.saving': 'Saving…',
      'form.reset': 'Reset to default',
      'form.error': 'Could not save: ',
      'form.localOnly': 'Saved in this browser only; the host route was unavailable.',
      'form.saved': 'Saved.',
    }

    var zh = {
      'page.title': '思考提示',
      'page.intro': '模型思考时 Chat 显示的那行提示：文字、特效与节奏。',
      'effect.default': '默认',
      'effect.typewriter': '打字机',
      'effect.terminal': '命令行',
      'effect.decode': '解码',
      'decodeStyle.blocks': '符号块',
      'decodeStyle.hex': '十六进制',
      'form.decodeStyle': '解码噪声（可多选）',
      'form.decodeStyleHint': '两个都勾上：每次切换随机挑一种；至少保留一个。',
      'form.decodeSpeed': '解码速度',
      'form.decodeSpeedUnit': '毫秒/字',
      'form.enabled': '模型思考时显示自定义提示',
      'form.phrases': '提示文字（每行一条，多条循环播放）',
      'form.phrasesPlaceholder': '深度求索中，用时 {duration}\n正在深度思考…',
      'form.phrasesHint': '最多 {max} 条；可用 {duration}（本地化用时）、{seconds}（纯秒数）、{spinner}（转动标记）、{bar}（按总用时增长的进度条）。',
      'form.phrasesCount': '{count}/{max}',
      'form.phrasesOver': '{count}/{max} —— 只保留前 {max} 条',
      'form.random': '随机挑选下一条',
      'form.randomHint': '每条结束后随机挑一条，不按顺序循环；需要两条以上，预览仍按顺序演示。',
      'form.glitch': '偶发错字自动修正',
      'form.glitchHint': '只有刚打出来的字、或刚切进来的短语，才可能错一下再改回。',
      'form.glitchChance': '概率',
      'form.glitchTry': '试一次',
      'form.randomEffect': '每条短语随机换效果',
      'form.randomEffectHint': '每次切换短语时，从下面勾选的效果里随机挑一个。',
      'form.effectPool': '可选效果',
      'form.effectPoolHint': '勾两个以上；只勾一个就等于固定用它。',
      'form.effectPoolEmpty': '还没勾选：此时仍用上面的固定效果。',
      'form.effect': '特效',
      'form.cycle': '每条停留',
      'form.seconds': '秒',
      'form.typeSpeed': '打字速度',
      'form.msPerChar': '毫秒/字',
      'form.preview': '预览',
      'form.previewEmpty': '（没有提示文字）',
      'form.previewDuration': '3 秒',
      'form.save': '保存',
      'form.saving': '保存中…',
      'form.reset': '恢复默认',
      'form.error': '保存失败：',
      'form.localOnly': '宿主暂不可用，已保存到本机浏览器。',
      'form.saved': '已保存。',
    }

    /** Whether the browser speaks Chinese, so the copy fallback matches it. */
    var PREFER_ZH = typeof navigator !== 'undefined'
      && typeof navigator.language === 'string'
      && navigator.language.toLowerCase().indexOf('zh') === 0

    /** Fill `{name}` placeholders with a call site's values. */
    function interpolate(text, vars) {
      if (vars === undefined || vars === null) return text
      var out = text
      var names = Object.keys(vars)
      for (var i = 0; i < names.length; i += 1) {
        var name = names[i]
        out = out.split('{' + name + '}').join(String(vars[name]))
      }
      return out
    }

    /** One key without a seat's `props.t`: use the built-in dictionaries. */
    function say(key, vars) {
      var table = PREFER_ZH ? zh : en
      var text = table[key] !== undefined ? table[key] : (en[key] !== undefined ? en[key] : key)
      return interpolate(text, vars)
    }

    /** The translator for one seat: its own `props.t`, then `say`. */
    function translator(props) {
      var own = props !== null && props !== undefined ? props.t : undefined
      if (typeof own === 'function') return function (key, vars) { return interpolate(own(key), vars) }
      return say
    }

    // ── pure settings / animation helpers ──────────────────────────────────
    /** The most phrases one configuration may carry; the host stores the same cap. */
    var MAX_PHRASES = 25
    /** The longest phrase accepted, in code points. */
    var MAX_PHRASE_LENGTH = 120

    function clampInteger(value, min, max, fallback) {
      var number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, Math.round(number)))
    }

    function cleanPhrases(value) {
      if (!Array.isArray(value)) return DEFAULT_SETTINGS.phrases.slice()
      var phrases = []
      for (var i = 0; i < value.length; i += 1) {
        var item = value[i]
        if (typeof item !== 'string') continue
        var text = item.replace(/\r\n?/g, '\n').split('\n')[0].trim()
        if (text === '') continue
        phrases.push(Array.from(text).slice(0, MAX_PHRASE_LENGTH).join(''))
        if (phrases.length >= MAX_PHRASES) break
      }
      return phrases.length > 0 ? phrases : DEFAULT_SETTINGS.phrases.slice()
    }

    /**
     * How many phrase lines the textarea really holds: blank lines and stray
     * whitespace do not count, and the cap is not applied, so the page can say
     * when the reader has typed more than will be kept.
     * @param {string} text - the textarea value.
     * @returns {number} the number of non-empty lines.
     */
    function countPhrases(text) {
      if (typeof text !== 'string') return 0
      var lines = text.split('\n')
      var count = 0
      for (var i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() !== '') count += 1
      }
      return count
    }

    /**
     * Keep only known effects, in the canonical order, without repeats.
     * @param {unknown} value - raw pool entries.
     * @returns {string[]} the cleaned pool; empty means "no pool".
     */
    function cleanEffects(value) {
      if (!Array.isArray(value)) return []
      var picked = {}
      for (var i = 0; i < value.length; i += 1) {
        var item = value[i]
        if (typeof item === 'string' && EFFECTS.indexOf(item) !== -1) picked[item] = true
      }
      var pool = []
      for (var j = 0; j < EFFECTS.length; j += 1) {
        if (picked[EFFECTS[j]] === true) pool.push(EFFECTS[j])
      }
      return pool
    }

    /**
     * Keep only known decode styles, in the canonical order, without repeats. An
     * empty pick falls back to the symbol style, so the effect always has a look.
     * @param {unknown} value - raw picked styles.
     * @returns {string[]} one or more styles.
     */
    function cleanDecodeStyles(value) {
      var list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : [])
      var picked = {}
      for (var i = 0; i < list.length; i += 1) {
        var item = list[i]
        if (typeof item === 'string' && DECODE_STYLES.indexOf(item) !== -1) picked[item] = true
      }
      var styles = []
      for (var j = 0; j < DECODE_STYLES.length; j += 1) {
        if (picked[DECODE_STYLES[j]] === true) styles.push(DECODE_STYLES[j])
      }
      return styles.length > 0 ? styles : ['blocks']
    }

    /**
     * Which decode style one step draws. With more than one style ticked, each
     * switch picks among them, seeded like the effect pool so a phrase never
     * changes its noise mid-line.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {number} step - rotation step now.
     * @param {number} phraseIndex - which phrase is showing.
     * @param {number} [salt] - the element's seed.
     * @returns {string} one of {@link DECODE_STYLES}.
     */
    function resolveDecodeStyle(settings, step, phraseIndex, salt) {
      var styles = cleanDecodeStyles(settings.decodeStyles)
      if (styles.length === 1) return styles[0]
      var slot = Math.max(0, Math.floor(Number(step) || 0))
      var seed = Math.max(0, Math.floor(Number(salt) || 0))
      var index = mix(mix(slot + seed + 7) + (Math.max(0, Math.floor(Number(phraseIndex) || 0)) * 131) + 53) % styles.length
      return styles[index] !== undefined ? styles[index] : styles[0]
    }

    function normalizeSettings(raw) {
      var record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      return {
        enabled: record.enabled !== false,
        phrases: cleanPhrases(record.phrases),
        random: record.random === true,
        glitch: record.glitch === true,
        glitchChance: clampInteger(record.glitchChance, 0, 100, GLITCH_CHANCE),
        effect: typeof record.effect === 'string' && EFFECTS.indexOf(record.effect) !== -1 ? record.effect : 'default',
        effectPool: cleanEffects(record.effectPool),
        randomEffect: record.randomEffect === true,
        // `decodeStyle` is the single-value shape this field had before styles
        // became a pick; an old document is read through it and then rewritten.
        decodeStyles: cleanDecodeStyles(record.decodeStyles !== undefined ? record.decodeStyles : record.decodeStyle),
        decodeSpeedMs: clampInteger(record.decodeSpeedMs, 10, 300, DEFAULT_DECODE_SPEED_MS),
        cycleSeconds: clampInteger(record.cycleSeconds, 1, 60, DEFAULT_SETTINGS.cycleSeconds),
        typeSpeedMs: clampInteger(record.typeSpeedMs, 10, 300, DEFAULT_SETTINGS.typeSpeedMs),
      }
    }

    /** Turn the textarea value into the phrase list used by both preview and runtime. */
    function phrasesFromTextarea(text) {
      if (typeof text !== 'string') return DEFAULT_SETTINGS.phrases.slice()
      return cleanPhrases(text.split('\n'))
    }

    /** Replace `{duration}` with the host's localized elapsed-time text. */
    function applyDuration(phrase, duration) {
      var value = typeof duration === 'string' ? duration : ''
      return String(phrase).split('{duration}').join(value)
    }

    /**
     * Whole seconds of running time, for `{seconds}`. Counted from the elapsed
     * clock rather than parsed out of the host's localized text: past a minute
     * that text leads with minutes ("1 分 5 秒"), so its first number is 1 even
     * when 65 seconds have passed. The text is only a fallback when no clock is
     * available; there its first number is what the caller can offer.
     * @param {string} duration - host-formatted elapsed text.
     * @param {number} [elapsedMs] - elapsed time since the label appeared.
     * @returns {string} the seconds, as text.
     */
    function durationSeconds(duration, elapsedMs) {
      if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
        return String(Math.floor(Math.max(0, elapsedMs) / 1000))
      }
      var match = typeof duration === 'string' ? duration.match(/\d+/) : null
      return match === null ? '0' : match[0]
    }

    /** One frame of the `{spinner}` mark for `elapsedMs` of running time. */
    function spinnerFrame(elapsedMs) {
      var frame = Math.floor(Math.max(0, elapsedMs) / SPINNER_FRAME_MS) % SPINNER_FRAMES.length
      return SPINNER_FRAMES[frame]
    }

    /**
     * One frame of the `{bar}` mark: a block per second of running time, then
     * held full. It measures the whole running period, not one rotation step, so
     * a rotating phrase list still shows a growing bar.
     * @param {number} elapsedMs - elapsed time since the label appeared.
     * @param {number} [cells] - cells in the bar.
     * @returns {string} the bar with no line breaks.
     */
    function barFrame(elapsedMs, cells) {
      var total = Math.max(1, Math.round(Number(cells) || BAR_CELLS))
      var filled = Math.min(total, Math.floor(Math.max(0, elapsedMs) / BAR_CELL_MS))
      return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(total - filled)
    }

    /**
     * Every placeholder in one phrase, at one instant of running time.
     * @param {string} phrase - the configured phrase.
     * @param {number} elapsedMs - elapsed time since the label appeared.
     * @param {string} duration - host-formatted elapsed text for `{duration}`.
     * @returns {string} the phrase with its placeholders filled.
     */
    function renderText(phrase, elapsedMs, duration) {
      var text = applyDuration(phrase, duration)
      text = text.split('{seconds}').join(durationSeconds(duration, elapsedMs))
      text = text.split('{spinner}').join(spinnerFrame(elapsedMs))
      return text.split('{bar}').join(barFrame(elapsedMs))
    }

    /** A 32-bit avalanche so a slot number scatters; deterministic, so testable. */
    function mix(value) {
      var bits = value | 0
      bits = Math.imul(bits ^ 0x9e3779b9, 0x85ebca6b)
      bits = Math.imul(bits ^ (bits >>> 13), 0xc2b2ae35)
      return (bits ^ (bits >>> 16)) >>> 0
    }

    /**
     * Whether an effect may raise the automatic typo. A decode frame is already
     * full of noise, and a typo on top of it only muddies both effects; the
     * page's manual "try it" press still works there.
     * @param {string} effect - the effect in force.
     * @returns {boolean} whether the automatic typo may fire.
     */
    function glitchAllowed(effect) {
      return effect !== 'decode'
    }

    /**
     * Whether one event flickers, at `chance` percent. The draw is a hash of the
     * event, so most events stay clean while the same event always answers alike.
     * @param {number} seed - the event's identity (phrase and position, or step).
     * @param {number} chance - percent of events that flicker, 0 to 100.
     * @returns {boolean} whether this event flickers.
     */
    function shouldGlitch(seed, chance) {
      var percent = Math.max(0, Math.min(100, Math.round(Number(chance) || 0)))
      if (percent <= 0) return false
      if (percent >= 100) return true
      return mix(seed * 7 + 13) % 100 < percent
    }

    /**
     * How many glyphs the typing effect has revealed so far, counted off the
     * typing clock alone -- never off the rendered text. A placeholder that grows
     * wider (9 秒 to 10 秒) must not look like a new glyph arriving.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {number} phraseElapsed - elapsed time inside the current phrase.
     * @param {string} [effect] - the effect in force this step, when it is picked
     *   per step rather than fixed in the settings.
     * @returns {number | null} the revealed count, or null when the effect shows
     *   the whole line at once and therefore types nothing.
     */
    function typingProgress(settings, phraseElapsed, effect) {
      var active = typeof effect === 'string' ? effect : settings.effect
      var speed = Math.max(10, Number(settings.typeSpeedMs) || DEFAULT_SETTINGS.typeSpeedMs)
      if (active === 'typewriter') return Math.max(0, Math.floor(phraseElapsed / speed) + 1)
      if (active === 'terminal') return Math.max(0, Math.floor(phraseElapsed / speed))
      return null
    }

    /**
     * How many code points of the phrase are on screen at `phraseElapsed`.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {string} text - the phrase with its placeholders filled.
     * @param {number} phraseElapsed - elapsed time inside the current phrase.
     * @param {string} [effect] - the effect in force this step.
     * @returns {number} the visible code-point count.
     */
    function typingCount(settings, text, phraseElapsed, effect) {
      var glyphs = Array.from(String(text)).length
      var revealed = typingProgress(settings, phraseElapsed, effect)
      return revealed === null ? glyphs : Math.min(glyphs, revealed)
    }

    /**
     * The effects a step can actually land on: the ticked pool when the random
     * switch is on and the pool has entries, otherwise the fixed effect. The page
     * reads this, so an empty pool still shows the controls of the effect that
     * will really run.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @returns {string[]} one or more effects.
     */
    function activeEffects(settings) {
      var pool = Array.isArray(settings.effectPool) ? settings.effectPool : []
      if (settings.randomEffect === true && pool.length > 0) return pool
      return [settings.effect]
    }

    /**
     * The effect in force for one rotation step. With a pool and the switch on,
     * each step draws from the pool, so a phrase can come in with any of the
     * chosen effects; otherwise the fixed effect applies. `salt` is the running
     * element's own seed: without it the draw repeats the same table on every new
     * label, which reads as a fixed schedule rather than a random pick.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {number} step - rotation step now.
     * @param {number} phraseIndex - which phrase is showing.
     * @param {number} [salt] - the element's seed.
     * @returns {string} one of {@link EFFECTS}.
     */
    function resolveEffect(settings, step, phraseIndex, salt) {
      var pool = Array.isArray(settings.effectPool) ? settings.effectPool : []
      if (settings.randomEffect !== true || pool.length === 0) return settings.effect
      var slot = Math.max(0, Math.floor(Number(step) || 0))
      var seed = Math.max(0, Math.floor(Number(salt) || 0))
      // Mix twice: a single pass over the step counter left runs of the same
      // effect, which reads as a pattern rather than a draw.
      var index = mix(mix(slot + seed) + (Math.max(0, Math.floor(Number(phraseIndex) || 0)) * 131) + 17) % pool.length
      return pool[index] !== undefined ? pool[index] : settings.effect
    }

    /**
     * Where in the settle order one position sits. Every position gets its own
     * place, drawn from a hash, so the line fills in scattered rather than left to
     * right -- a prefix is the typewriter's shape, not a decode's.
     * @param {number} index - the code-point position.
     * @param {number} total - code points in the line.
     * @param {number} [salt] - the element's seed, so the order differs per label.
     * @returns {number} the position's rank, from 0 to total-1.
     */
    function decodeRank(index, total, salt) {
      if (total <= 1) return 0
      return mix(index * 7 + 3 + Math.max(0, Math.floor(Number(salt) || 0))) % total
    }

    /**
     * Whether one glyph is East Asian full width, the only width that matches a
     * CJK character in an equal-width font. Ambiguous glyphs such as the shading
     * blocks advance by half a CJK glyph there, which makes a settling line widen.
     * @param {string} glyph - one code point.
     * @returns {boolean} whether it occupies a full CJK cell.
     */
    function isFullWidthGlyph(glyph) {
      var point = String(glyph).codePointAt(0)
      if (!Number.isFinite(point)) return false
      // Fullwidth forms, CJK symbols and punctuation, and the katakana middle dot
      // are the ranges this plugin draws from; all of them are width F or W.
      return (point >= 0xff01 && point <= 0xff60)
        || (point >= 0x3000 && point <= 0x303f)
        || point === 0x30fb
    }

    /**
     * Render one decode frame: positions whose rank has come up show their real
     * glyph, the rest show noise, coarse when far from settling and fine when
     * close. The `blocks` style draws full-width symbols, the `hex` style uses hex
     * digits, so a decode can read as either a fading scan or raw data.
     * @param {string} text - the fully rendered phrase.
     * @param {number} phraseElapsed - elapsed time inside the current phrase.
     * @param {number} [salt] - the element's seed, so the noise differs per label.
     * @param {number} [speedMs] - how long one settle step takes; the same 10-300
     *   range the settings document stores, so a caller cannot drift from it.
     * @param {string} [style] - `blocks` or `hex`.
     * @returns {string} the decoded frame, same code-point count.
     */
    function decodeText(text, phraseElapsed, salt, speedMs, style) {
      var glyphs = Array.from(String(text))
      var total = glyphs.length
      if (total === 0) return ''
      var raw = Number(speedMs)
      var step = Math.max(10, Math.min(300, Math.round(Number.isFinite(raw) ? raw : DEFAULT_DECODE_SPEED_MS)))
      var hex = style === 'hex'
      var settled = Math.max(0, Math.floor((Number(phraseElapsed) || 0) / step))
      if (settled >= total) return glyphs.join('')
      var out = []
      for (var i = 0; i < total; i += 1) {
        var glyph = glyphs[i]
        // A space is never noise: word breaks would collapse into the symbols.
        if (glyph === ' ') {
          out.push(' ')
          continue
        }
        var rank = decodeRank(i, total, salt)
        if (rank < settled) {
          out.push(glyph)
          continue
        }
        var left = rank - settled
        var stage = left >= 3 ? 0 : left === 2 ? 1 : 2
        var seed = mix(i * 131 + stage * 17 + (Number(salt) || 0))
        out.push(hex
          ? DECODE_HEX[seed % DECODE_HEX.length]
          : DECODE_STAGES[stage][seed % DECODE_STAGES[stage].length])
      }
      return out.join('')
    }

    /**
     * Advance one element's typo bookkeeping and report the flicker to show now.
     * A typing effect raises one event per glyph that the typing clock reveals, an
     * effect that shows the line at once raises one per rotation step, and the
     * very first observation only records the baseline. Each event draws against
     * the chance; a draw that misses is the end of it, so a line that is already
     * correct is never spoiled again. A rotation also ends any typo the previous
     * phrase was still showing, so nothing drifts across a switch.
     * @param {{ready: boolean, reveal: number | null, step: number, glitch: object | null}} state - advanced in place.
     * @param {number} elapsedMs - elapsed time since the label appeared.
     * @param {number | null} reveal - glyphs the typing clock has revealed, or null.
     * @param {number} textLength - code points the current frame renders.
     * @param {number} step - rotation step now.
     * @param {number} chance - percent of events that flicker.
     * @returns {{index: number, since: number, seed: number} | null} the flicker to show, if any.
     */
    function advanceGlitch(state, elapsedMs, reveal, textLength, step, chance) {
      if (state.ready !== true) {
        state.ready = true
        state.reveal = reveal
        state.step = step
        state.glitch = null
        return null
      }
      var switched = step !== state.step
      var active = state.glitch
      if (active !== null && elapsedMs - active.since >= GLITCH_FIX_MS) active = null
      if (switched) {
        // A new phrase starts clean. An effect that types spoils its first glyph,
        // which is the arrival a reader actually sees; an effect that shows the
        // line at once spoils two of its glyphs.
        active = null
        if (reveal === null) {
          var switchSeed = step * 977 + 13
          if (shouldGlitch(switchSeed, chance)) {
            active = { index: -1, since: elapsedMs, seed: switchSeed }
          }
        } else if (reveal >= 1 && reveal <= textLength) {
          var firstSeed = step * 131 + reveal
          if (shouldGlitch(firstSeed, chance)) {
            active = { index: reveal - 1, since: elapsedMs, seed: firstSeed }
          }
        }
      } else if (
        reveal !== null
        && state.reveal !== null
        && reveal > state.reveal
        // Past the end of the line there is no glyph left to spoil, so the clock
        // running on raises nothing.
        && reveal <= textLength
      ) {
        var seed = step * 131 + reveal
        if (shouldGlitch(seed, chance)) {
          active = { index: reveal - 1, since: elapsedMs, seed }
        }
      }
      state.reveal = reveal
      state.step = step
      state.glitch = active
      return active
    }

    /**
     * The flicker the configuration page's "try it" button asks for.
     * @param {{current: number} | undefined} probeRef - when the button was pressed.
     * @param {number} elapsedMs - elapsed time in the preview.
     * @returns {{index: number, since: number, seed: number} | null} the flicker to show.
     */
    function probeGlitch(probeRef, elapsedMs) {
      var at = probeRef !== null && probeRef !== undefined ? Number(probeRef.current) : 0
      if (!Number.isFinite(at) || at <= 0) return null
      var since = Date.now() - at
      if (since < 0 || since >= GLITCH_FIX_MS) return null
      // Each press spoils different glyphs.
      return { index: -1, since: elapsedMs - since, seed: Math.floor(at / 10) + 17 }
    }

    /**
     * Corrupt `text` for one flicker. The replacement keeps the code-point count,
     * so a typing effect's progress does not jump. `index >= 0` spoils just the
     * glyph that just arrived; `index < 0` spoils two of them, for a phrase that
     * just switched in.
     * @param {string} text - the frame's visible text.
     * @param {number} index - the arriving glyph, or -1 for a switched-in phrase.
     * @param {number} seed - the event's identity, for picking the glyphs.
     * @param {number} [reserveTail] - trailing code points left alone, such as a
     *   command-line cursor.
     * @returns {string} the corrupted text, unchanged when nothing can be hit.
     */
    function glitchText(text, index, seed, reserveTail) {
      var glyphs = Array.from(String(text))
      var tail = Math.max(0, Math.round(Number(reserveTail) || 0))
      // Positions 1..(len-1-tail): the head stays readable, the tail is reserved.
      var span = glyphs.length - 1 - tail
      if (glyphs.length < 2 || span < 1) return glyphs.join('')
      if (index >= 0) {
        if (index < 1 || index > span) return glyphs.join('')
        glyphs[index] = GLITCH_GLYPHS[mix(seed + index + 7) % GLITCH_GLYPHS.length]
        return glyphs.join('')
      }
      var first = 1 + (mix(seed + 1) % span)
      glyphs[first] = GLITCH_GLYPHS[mix(seed + first + 7) % GLITCH_GLYPHS.length]
      if (span > 1) {
        // One to span-1 places past the first hit, so the two never coincide.
        var stride = 1 + (mix(seed + 101) % (span - 1))
        var second = 1 + ((first - 1 + stride) % span)
        glyphs[second] = GLITCH_GLYPHS[mix(seed + second + 13) % GLITCH_GLYPHS.length]
      }
      return glyphs.join('')
    }

    /** Which phrase is active after `elapsedMs` of one running period. */
    function phraseIndexAt(count, cycleMs, elapsedMs) {
      if (count <= 1 || cycleMs <= 0) return 0
      return Math.floor(Math.max(0, elapsedMs) / cycleMs) % count
    }

    /**
     * The phrase one random step shows. The draw comes from `rng`, and the
     * phrase the previous step showed is never drawn again; the re-draw that
     * follows such a collision keeps the remaining phrases equally likely.
     * @param {number} count - phrases on offer.
     * @param {number} previous - the index the previous step showed, or -1.
     * @param {() => number} rng - a `[0, 1)` draw.
     * @returns {number} the chosen index.
     */
    function pickDifferentIndex(count, previous, rng) {
      if (count <= 1) return 0
      var index = Math.max(0, Math.min(count - 1, Math.floor(rng() * count)))
      if (index === previous) {
        // Drawn again from the phrases the previous step left, which keeps them
        // equally likely and can never land back on it.
        index = (previous + 1 + Math.min(count - 2, Math.floor(rng() * (count - 1)))) % count
      }
      return index
    }

    /**
     * Move one running element's draw state to the rotation step `elapsedMs`
     * falls in. A step keeps its phrase for the whole dwell, so the state only
     * moves when the cycle index does -- one draw per step, never per tick.
     * @param {{cycle: number, randomIndex: number}} state - the element's draw state, advanced in place.
     * @param {number} count - phrases on offer.
     * @param {number} cycleMs - one dwell, in milliseconds.
     * @param {number} elapsedMs - elapsed time since the label appeared.
     * @param {() => number} rng - a `[0, 1)` draw.
     * @returns {boolean} whether the step changed.
     */
    function randomStep(state, count, cycleMs, elapsedMs, rng) {
      var cycle = Math.floor(Math.max(0, elapsedMs) / Math.max(1, cycleMs))
      if (cycle === state.cycle) return false
      state.cycle = cycle
      state.randomIndex = pickDifferentIndex(count, state.randomIndex, rng)
      return true
    }

    /**
     * Which phrase one running element shows at `elapsedMs`, honouring a random
     * step's pick when the caller has one.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {number} elapsedMs - elapsed time since the label appeared.
     * @param {number} [randomIndex] - the phrase a random step picked, if any.
     * @returns {number} the phrase index.
     */
    function activePhraseIndex(settings, elapsedMs, randomIndex) {
      var count = settings.phrases.length
      if (count <= 1) return 0
      if (settings.random === true && Number.isInteger(randomIndex) && randomIndex >= 0) {
        return randomIndex % count
      }
      var cycleMs = Math.max(1, Number(settings.cycleSeconds) || DEFAULT_SETTINGS.cycleSeconds) * 1000
      return phraseIndexAt(count, cycleMs, elapsedMs)
    }

    /**
     * One frame of the running label.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {number} runElapsedMs - elapsed time since the running status appeared.
     * @param {string} duration - host-formatted elapsed text for `{duration}`.
     * @param {number} [randomIndex] - the phrase a random step picked, if any; without
     *   it -- in the configuration page's preview -- the line rotates in order.
     * @param {{index: number, since: number, seed: number} | null} [glitchAt] - a
     *   flicker still in its correction window; the page's "try it" button passes
     *   one even while the switch is off.
     * @param {{effect?: string, salt?: number}} [view] - the effect a step resolved to
     *   and the element's seed, when the caller picks one per step instead of
     *   reading it from the settings.
     * @returns {{text: string, opacity: number, shiftX: number, shiftY: number, caret: boolean, effect: string}} frame.
     */
    function effectFrame(settings, runElapsedMs, duration, randomIndex, glitchAt, view) {
      var options = view !== null && view !== undefined && typeof view === 'object' ? view : {}
      var effect = typeof options.effect === 'string' ? options.effect : settings.effect
      var salt = Math.max(0, Math.floor(Number(options.salt) || 0))
      var phrases = settings.phrases
      var cycleMs = Math.max(1, Number(settings.cycleSeconds) || DEFAULT_SETTINGS.cycleSeconds) * 1000
      var cycling = phrases.length > 1
      var index = activePhraseIndex(settings, runElapsedMs, randomIndex)
      var phraseElapsed = cycling ? runElapsedMs % cycleMs : Math.max(0, runElapsedMs)
      var full = renderText(phrases[index] !== undefined ? phrases[index] : '', runElapsedMs, duration)
      var frame = {
        text: full,
        opacity: 1,
        shiftX: 0,
        shiftY: 0,
        caret: false,
        effect: effect,
      }
      // A command-line cursor is part of the text, so the flicker must not eat it.
      var reserveTail = 0

      if (effect === 'typewriter') {
        var chars = Array.from(full)
        var typed = typingCount(settings, full, phraseElapsed, effect)
        frame.text = chars.slice(0, typed).join('')
        frame.caret = typed < chars.length
      } else if (effect === 'terminal') {
        // Command line: the text arrives one character behind a cursor, and the
        // finished line drops it -- `_`, `你_`, `你好_`, `你好啊`.
        var glyphs = Array.from(full)
        var shown = typingCount(settings, full, phraseElapsed, effect)
        if (shown < glyphs.length) {
          frame.text = glyphs.slice(0, shown).join('') + TERMINAL_CURSOR
          reserveTail = 1
        }
      } else if (effect === 'decode') {
        frame.text = decodeText(
          full,
          phraseElapsed,
          salt,
          settings.decodeSpeedMs,
          resolveDecodeStyle(settings, Math.floor(runElapsedMs / cycleMs), index, salt),
        )
      }

      // A flicker this frame still holds: only a wrong glyph that has not corrected
      // itself yet. `glitchAt` also carries the page's "try it" press, which works
      // while the switch is off.
      var flicker = glitchAt !== null && glitchAt !== undefined && typeof glitchAt === 'object' ? glitchAt : null
      var age = flicker === null ? -1 : runElapsedMs - Number(flicker.since)
      if (flicker !== null && age >= 0 && age < GLITCH_FIX_MS) {
        frame.text = glitchText(frame.text, Number(flicker.index), Number(flicker.seed), reserveTail)
      }

      return frame
    }

    // ── local persistence (fallback when the host route is absent) ─────────
    function readLocalSettings() {
      try {
        var text = window.localStorage.getItem(STORAGE_KEY)
        if (text === null || text === '') return normalizeSettings(undefined)
        return normalizeSettings(JSON.parse(text))
      } catch (error) {
        return normalizeSettings(undefined)
      }
    }

    function writeLocalSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      } catch (error) {
        // A private window can refuse storage; the host route remains the source.
      }
    }

    // ── preference store ──────────────────────────────────────────────────
    // The accepted document is the single source of truth: the runtime reads it
    // on every tick, and the configuration page seeds its draft from it when it
    // mounts and adopts whatever the host accepted after a save.
    var currentSettings = normalizeSettings(readLocalSettings())
    var settingsMutationSeq = 0
    var hostReadPromise = null

    // ── HTTP helpers ──────────────────────────────────────────────────────
    async function postJson(path, body, timeoutMs) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null
      var timer = controller === null ? undefined : setTimeout(function () { controller.abort() }, timeoutMs)
      try {
        var response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [MARKER]: '1' },
          body: JSON.stringify(body),
          ...(controller === null ? {} : { signal: controller.signal }),
        })
        var payload = await response.json().catch(function () { return null })
        if (!response.ok || payload === null || payload.ok !== true) {
          throw new Error(payload !== null && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status)
        }
        return payload.value
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /**
     * Read the host's accepted document; local settings stand in until it
     * answers. Concurrent readers share one request, so a page opened during
     * activation waits on that read instead of asking a second time.
     */
    function loadFromHost() {
      if (hostReadPromise !== null) return hostReadPromise
      hostReadPromise = readHostDocument()
      return hostReadPromise
    }

    async function readHostDocument() {
      var requestSeq = settingsMutationSeq
      try {
        var value = await postJson(CONFIG_ROUTE, {}, REQUEST_TIMEOUT_MS)
        if (requestSeq === settingsMutationSeq && value !== null && typeof value === 'object') {
          currentSettings = normalizeSettings(value)
          writeLocalSettings(currentSettings)
        }
      } catch (error) {
        // Host half may not be mounted yet during HMR; the local copy is enough.
        if (typeof console !== 'undefined' && console.warn) console.warn('[thinking-phrase] host config unavailable:', error)
      } finally {
        // The latch is per request, not per page: a later mount reads again, so a
        // page that was seeded from this browser's own copy still converges.
        hostReadPromise = null
      }
    }

    /**
     * Save one draft. The host document is authoritative; a failed route still
     * saves locally so a transient startup cannot lose the reader's choice.
     */
    async function saveSettings(raw) {
      settingsMutationSeq += 1
      var next = normalizeSettings(raw)
      var localOnly = false
      try {
        var stored = await postJson(SAVE_ROUTE, { settings: next }, SAVE_TIMEOUT_MS)
        currentSettings = normalizeSettings(stored)
      } catch (error) {
        localOnly = true
        currentSettings = next
      }
      // Any read issued before this save settled captured the revision from
      // before it and can still answer with the older document; moving the
      // revision here discards that answer too.
      settingsMutationSeq += 1
      writeLocalSettings(currentSettings)
      return { settings: currentSettings, localOnly: localOnly }
    }

    // ── runtime: replace the generated text of the running label ──────────
    var localeService = null
    var runStates = new WeakMap()
    var durationTemplate = ''
    var durationTemplateLocale = null

    /**
     * Ask the Chat namespace for its own `{duration}` template, then cut the
     * real elapsed text out of the label running in the DOM. This keeps the
     * extraction locale-independent (ja puts the duration first, zh puts it
     * after "用时", etc.) without rewriting the shared locale service.
     */
    function currentDurationTemplate() {
      if (localeService === null || localeService === undefined || typeof localeService.translate !== 'function') return ''
      var active = ''
      try {
        active = typeof localeService.getLocale === 'function' ? localeService.getLocale().active : ''
      } catch (error) {
        active = ''
      }
      if (active !== durationTemplateLocale || durationTemplate === '') {
        try {
          var candidate = String(localeService.translate('chat', 'chat.deepDivingFor', { duration: '[DURATION]' }))
          if (candidate !== '' && candidate !== 'chat.deepDivingFor') {
            durationTemplate = candidate
            durationTemplateLocale = active
          } else {
            durationTemplate = ''
          }
        } catch (error) {
          durationTemplate = ''
        }
      }
      return durationTemplate
    }

    /** Read one running element's original label and return only its duration. */
    function readDurationFromElement(root) {
      try {
        var node = root.querySelector('[data-shimmer-text]')
        var label = node === null ? '' : node.getAttribute('data-shimmer-text') || ''
        if (label === '') return ''
        var template = currentDurationTemplate()
        var prefix = ''
        var suffix = ''
        if (template !== '') {
          var parts = template.split('[DURATION]')
          prefix = parts[0] || ''
          suffix = parts.length > 1 ? parts.slice(1).join('[DURATION]') : ''
        }
        if (prefix !== '' || suffix !== '') {
          var start = prefix === '' ? 0 : label.indexOf(prefix)
          var end = suffix === '' ? label.length : label.lastIndexOf(suffix)
          if (start >= 0 && end >= start + prefix.length) {
            return label.slice(start + prefix.length, end).trim()
          }
        }
        var match = label.match(/(\d[\d\s.,:]*\s*[^\s·]+(?:\s+[^\s·]+){0,2})\s*(?:···)?$/)
        return match === null ? '' : match[1].trim()
      } catch (error) {
        return ''
      }
    }

    function clearRuntimeElement(element) {
      element.removeAttribute('data-dsh-thinking-phrase')
      var shimmer = element.querySelector('[data-shimmer]')
      if (shimmer !== null) {
        shimmer.removeAttribute('data-dsh-thinking-phrase-text')
        shimmer.removeAttribute('data-dsh-thinking-effect')
      }
      element.style.removeProperty('--dsh-thinking-opacity')
      element.style.removeProperty('--dsh-thinking-shift-x')
      element.style.removeProperty('--dsh-thinking-shift-y')
      element.style.removeProperty('--dsh-thinking-caret-width')
      var labels = element.querySelectorAll('[data-shimmer-text]')
      for (var i = 0; i < labels.length; i += 1) labels[i].removeAttribute('data-dsh-thinking-phrase-text')
      runStates.delete(element)
    }

    /**
     * Write one animation frame into one running root. The text attribute must
     * live on the `[data-shimmer]` root because `attr()` in its `::before`
     * sees only that element's own attributes.
     * @returns {boolean} false when the host no longer has a shimmer root.
     */
    function writeFrameToElement(element, frame) {
      var shimmer = element.querySelector('[data-shimmer]')
      if (shimmer === null) return false
      shimmer.setAttribute('data-dsh-thinking-phrase-text', frame.text)
      shimmer.setAttribute('data-dsh-thinking-effect', frame.effect)
      var labels = element.querySelectorAll('[data-shimmer-text]')
      for (var i = 0; i < labels.length; i += 1) {
        labels[i].setAttribute('data-dsh-thinking-phrase-text', frame.text)
      }
      element.style.setProperty('--dsh-thinking-opacity', String(frame.opacity))
      element.style.setProperty('--dsh-thinking-shift-x', frame.shiftX + 'px')
      element.style.setProperty('--dsh-thinking-shift-y', frame.shiftY + 'px')
      element.style.setProperty('--dsh-thinking-caret-width', frame.caret ? '1px' : '0px')
      return true
    }

    /**
     * Repeat `tick` at roughly {@link TICK_MS}, on the frame clock when the host has
     * one. A frame clock stops painting in a hidden tab, so the plugin stops working
     * there instead of polling twenty times a second; because every frame is drawn
     * from an absolute elapsed time, a label that resumes after being hidden simply
     * shows the right second rather than replaying the frames it missed. A host
     * without a frame clock (a test runner) falls back to a plain interval.
     * @param {() => void} tick - the work to repeat.
     * @returns {() => void} a stop function.
     */
    function startClock(tick) {
      if (typeof requestAnimationFrame !== 'function' || typeof cancelAnimationFrame !== 'function') {
        var handle = setInterval(tick, TICK_MS)
        return function () { clearInterval(handle) }
      }
      var frame = 0
      // Land on the first frame, then not before a tick has passed.
      var last = -TICK_MS
      // Leave a frame's slack: three frames of a 60 Hz display are 50 ms, and a
      // strict comparison would skip every other one.
      var spacing = TICK_MS - 6
      var loop = function (now) {
        frame = requestAnimationFrame(loop)
        if (now - last < spacing) return
        last = now
        tick()
      }
      frame = requestAnimationFrame(loop)
      return function () { cancelAnimationFrame(frame) }
    }

    function tickRuntime() {
      if (typeof document === 'undefined') return
      var elements = document.querySelectorAll('[data-chat-running]')
      for (var i = 0; i < elements.length; i += 1) {
        var element = elements[i]
        if (element.hasAttribute('data-holding') || !currentSettings.enabled || currentSettings.phrases.length === 0) {
          clearRuntimeElement(element)
          continue
        }
        if (element.querySelector('[data-shimmer]') === null) {
          // A future Chat release changed TextShimmer's shape: leave the native
          // label untouched instead of painting a detached overlay.
          clearRuntimeElement(element)
          continue
        }
        var now = Date.now()
        var state = runStates.get(element)
        if (state === undefined) {
          state = {
            startedAt: now,
            frameKey: '',
            cycle: -1,
            randomIndex: -1,
            glitchState: { ready: false, reveal: null, step: 0, glitch: null },
            glitch: null,
            // The element's own seed: without it a pool repeats the same table on
            // every new label, and a decode draws the same noise pattern.
            salt: Math.floor(Math.random() * 1e9),
          }
          runStates.set(element, state)
        }
        var elapsed = now - state.startedAt
        var cycleMs = Math.max(1, Number(currentSettings.cycleSeconds) || DEFAULT_SETTINGS.cycleSeconds) * 1000
        var cycling = currentSettings.phrases.length > 1
        var phraseElapsed = cycling ? elapsed % cycleMs : Math.max(0, elapsed)
        if (currentSettings.random === true && cycling) {
          randomStep(state, currentSettings.phrases.length, cycleMs, elapsed, Math.random)
        } else {
          state.cycle = -1
          state.randomIndex = -1
        }

        // A typo only happens on a glyph the typing clock reveals, or on a switch
        // between whole-line phrases, and only on its own draw.
        var phraseIndex = activePhraseIndex(currentSettings, elapsed, state.randomIndex)
        var step = cycling ? Math.floor(elapsed / cycleMs) : 0
        var effect = resolveEffect(currentSettings, step, phraseIndex, state.salt)
        var duration = readDurationFromElement(element)
        var phraseText = renderText(
          currentSettings.phrases[phraseIndex] !== undefined ? currentSettings.phrases[phraseIndex] : '',
          elapsed,
          duration,
        )
        var textLength = Array.from(phraseText).length
        if (currentSettings.glitch === true && glitchAllowed(effect)) {
          state.glitch = advanceGlitch(
            state.glitchState,
            elapsed,
            typingProgress(currentSettings, phraseElapsed, effect),
            textLength,
            step,
            currentSettings.glitchChance,
          )
        } else {
          state.glitchState.ready = false
          state.glitch = null
        }

        var frame = effectFrame(currentSettings, elapsed, duration, state.randomIndex, state.glitch, {
          effect: effect,
          salt: state.salt,
        })
        var key = [
          frame.text,
          frame.opacity.toFixed(3),
          frame.shiftX.toFixed(2),
          frame.shiftY.toFixed(2),
          frame.caret ? '1' : '0',
          frame.effect,
        ].join('\u0000')
        if (key !== state.frameKey) {
          state.frameKey = key
          if (!writeFrameToElement(element, frame)) {
            clearRuntimeElement(element)
            continue
          }
        }
        // The attribute gates every style rule; writing the same value again still
      // makes the engine re-evaluate the attribute selectors, so only write when it
      // is not already set.
      if (element.getAttribute('data-dsh-thinking-phrase') !== 'on') {
        element.setAttribute('data-dsh-thinking-phrase', 'on')
      }
      }
    }

    // ── styles ────────────────────────────────────────────────────────────
    var STYLE_TEXT = [
      // TextShimmer's normal content is a real text node; its decoration copy is
      // the only node carrying data-shimmer-text. Hide the normal copy and paint
      // our own line into the SAME grid cell as it: the root is an inline-grid
      // sized to max-content, so sharing the cell makes the box as wide as the
      // longer of the two lines. That box is also what the decoration layer
      // (inset: 0, overflow: clip) clips the shimmer sweep to -- painted out of
      // flow, a longer custom line would keep the stock width and lose the sweep
      // past the stock label's end.
      '[data-chat-running][data-dsh-thinking-phrase="on"] [data-shimmer] > span:first-child {',
      '  visibility: hidden;',
      '  grid-area: 1 / 1;',
      '}',
      '[data-chat-running][data-dsh-thinking-phrase="on"] [data-shimmer]::before {',
      '  content: attr(data-dsh-thinking-phrase-text);',
      '  grid-area: 1 / 1;',
      '  display: flex;',
      '  align-items: center;',
      '  white-space: pre;',
      '  overflow: visible;',
      '  pointer-events: none;',
      '  font: inherit;',
      '  letter-spacing: inherit;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      // Keep the existing shimmer sweep alive by feeding it the same text.
      '[data-chat-running][data-dsh-thinking-phrase="on"] [data-shimmer] > span:last-child [data-shimmer-text]::after {',
      '  content: attr(data-dsh-thinking-phrase-text) !important;',
      '  white-space: pre;',
      '}',
      '[data-chat-running][data-dsh-thinking-phrase="on"] [data-shimmer] {',
      '  opacity: var(--dsh-thinking-opacity, 1);',
      '  transform: translateY(var(--dsh-thinking-shift-y, 0px)) translateX(var(--dsh-thinking-shift-x, 0px));',
      '  border-right: var(--dsh-thinking-caret-width, 0px) solid currentColor;',
      '}',
    ].join('\n')

    function installStyles() {
      if (typeof document === 'undefined') return function () {}
      var existing = document.getElementById(STYLE_ID)
      if (existing !== null && existing.parentNode !== null) existing.parentNode.removeChild(existing)
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE_TEXT
      document.head.appendChild(style)
      return function () {
        if (style.parentNode !== null) style.parentNode.removeChild(style)
      }
    }

    // ── form controls ─────────────────────────────────────────────────────
    function Switch(props) {
      var enabled = props.checked === true
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': enabled,
        'aria-label': props.label,
        onClick: function () { props.onChange(!enabled) },
        style: {
          width: '34px', height: '20px', flex: 'none', padding: 0, border: 'none',
          borderRadius: '999px', cursor: 'pointer', position: 'relative',
          background: enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-3)',
          transition: 'background .16s ease',
        },
      }, h('span', {
        'aria-hidden': 'true',
        style: {
          position: 'absolute', top: '2px', left: enabled ? '16px' : '2px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: 'var(--dsw-alias-bg-overlay)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.24)',
          transition: 'left .16s ease',
        },
      }))
    }

    function EffectButton(props) {
      var selected = props.selected
      return h('button', {
        type: 'button',
        'aria-pressed': selected,
        onClick: props.onClick,
        style: {
          flex: '1 1 90px', minWidth: '76px', height: '28px', padding: '0 8px',
          border: 'none', borderRadius: '7px', cursor: 'pointer',
          background: selected ? 'var(--dsw-alias-brand-primary)' : 'transparent',
          color: selected ? '#ffffff' : 'var(--dsw-alias-label-secondary)',
          fontSize: '12px', fontWeight: selected ? 600 : 500,
        },
      }, props.children)
    }

    function NumberField(props) {
      return h('label', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      },
      h('span', null, props.label),
      h('input', {
        type: 'number',
        min: props.min,
        max: props.max,
        value: props.value,
        onChange: function (event) { props.onChange(event.target.value) },
        style: {
          width: '58px', height: '26px', boxSizing: 'border-box', padding: '0 6px',
          border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
          background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit', fontSize: '12px',
        },
      }),
      h('span', null, props.unit))
    }

    /**
     * What the preview must restart for. It has to name every setting the frame
     * depends on -- a field missing here leaves the preview frozen on the value
     * its timer was built with.
     * @param {ReturnType<typeof normalizeSettings>} settings - accepted settings.
     * @param {string} sampleDuration - the placeholder elapsed text to preview.
     * @returns {string} a stable key.
     */
    function previewKey(settings, sampleDuration) {
      return JSON.stringify([
        settings.phrases,
        settings.glitch === true,
        settings.glitchChance,
        settings.effect,
        settings.effectPool,
        settings.randomEffect,
        settings.decodeStyles,
        settings.decodeSpeedMs,
        settings.cycleSeconds,
        settings.typeSpeedMs,
        sampleDuration,
      ])
    }

    function Preview(props) {
      var t = props.t
      var settings = props.settings
      var probeRef = props.probeRef
      var sampleDuration = t('form.previewDuration')
      var pair = useState(function () { return effectFrame(settings, 0, sampleDuration) })
      var frame = pair[0]
      var setFrame = pair[1]
      var startedRef = useRef(Date.now())
      // The preview runs the same event-driven typo rule as the live label, so the
      // switch and the chance are visible here too.
      var glitchState = useRef({ ready: false, reveal: null, step: 0, glitch: null })
      var liveGlitch = useRef(null)
      // A fresh seed per mount, so a pooled effect or a decode does not replay the
      // same pattern every time the page opens.
      var saltRef = useRef(Math.floor(Math.random() * 1e9))
      var key = previewKey(settings, sampleDuration)
      useEffect(function () {
        startedRef.current = Date.now()
        glitchState.current = { ready: false, reveal: null, step: 0, glitch: null }
        liveGlitch.current = null
        saltRef.current = Math.floor(Math.random() * 1e9)
        setFrame(effectFrame(settings, 0, sampleDuration))
        var stopClock = startClock(function () {
          var elapsed = Date.now() - startedRef.current
          var cycleMs = Math.max(1, Number(settings.cycleSeconds) || DEFAULT_SETTINGS.cycleSeconds) * 1000
          var cycling = settings.phrases.length > 1
          var phraseElapsed = cycling ? elapsed % cycleMs : elapsed
          var index = activePhraseIndex(settings, elapsed, undefined)
          var step = cycling ? Math.floor(elapsed / cycleMs) : 0
          var effect = resolveEffect(settings, step, index, saltRef.current)
          var phraseText = renderText(
            settings.phrases[index] !== undefined ? settings.phrases[index] : '',
            elapsed,
            sampleDuration,
          )
          if (settings.glitch === true && glitchAllowed(effect)) {
            liveGlitch.current = advanceGlitch(
              glitchState.current,
              elapsed,
              typingProgress(settings, phraseElapsed, effect),
              Array.from(phraseText).length,
              step,
              settings.glitchChance,
            )
          } else {
            glitchState.current.ready = false
            liveGlitch.current = null
          }
          var forced = probeGlitch(probeRef, elapsed)
          setFrame(effectFrame(settings, elapsed, sampleDuration, undefined, forced !== null ? forced : liveGlitch.current, {
            effect: effect,
            salt: saltRef.current,
          }))
        })
        return stopClock
      }, [key])
      var text = frame.text === '' ? t('form.previewEmpty') : frame.text
      return h('div', {
        style: {
          minHeight: '42px', padding: '10px 12px', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: '8px',
          borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px dashed var(--dsw-alias-border-l2)',
          color: 'var(--dsw-alias-label-deep-diving)',
          fontSize: '13px', lineHeight: '20px', fontVariantNumeric: 'tabular-nums',
        },
      },
      h('span', {
        'aria-hidden': 'true',
        style: { width: '14px', height: '14px', flex: 'none', borderRadius: '50%', background: 'currentColor', opacity: 0.9 },
      }),
      h('span', {
        style: {
          whiteSpace: 'pre',
          opacity: frame.opacity,
          transform: 'translateY(' + frame.shiftY + 'px)',
        },
      }, text))
    }

    /**
     * The plugin's own configuration page, rendered on its card in the sidebar's
     * Plugins page (`plugins.bundle.config`, keyed by the bundle's package name).
     * The page owns the draft and the save control; the accepted host document
     * stays the authority for what the running label reads.
     */
    function SettingsPage(props) {
      var t = translator(props)
      var initial = currentSettings
      var [enabled, setEnabled] = useState(initial.enabled)
      var [text, setText] = useState(initial.phrases.join('\n'))
      var [random, setRandom] = useState(initial.random)
      var [glitch, setGlitch] = useState(initial.glitch)
      var [glitchChance, setGlitchChance] = useState(String(initial.glitchChance))
      var [effect, setEffect] = useState(initial.effect)
      var [effectPool, setEffectPool] = useState(initial.effectPool.slice())
      var [randomEffect, setRandomEffect] = useState(initial.randomEffect)
      var [cycleSeconds, setCycleSeconds] = useState(String(initial.cycleSeconds))
      var [typeSpeedMs, setTypeSpeedMs] = useState(String(initial.typeSpeedMs))
      var [decodeStyles, setDecodeStyles] = useState(initial.decodeStyles.slice())
      var [decodeSpeedMs, setDecodeSpeedMs] = useState(String(initial.decodeSpeedMs))
      var [busy, setBusy] = useState(false)
      var [notice, setNotice] = useState(null)
      var [error, setError] = useState(null)
      var touchedRef = useRef(false)
      // When the "try it" button was pressed; the preview reads it every tick.
      var glitchProbeRef = useRef(0)

      var draft = {
        enabled: enabled,
        phrases: phrasesFromTextarea(text),
        random: random,
        glitch: glitch,
        glitchChance: Number(glitchChance),
        effect: effect,
        effectPool: effectPool,
        randomEffect: randomEffect,
        decodeStyles: decodeStyles,
        decodeSpeedMs: Number(decodeSpeedMs),
        cycleSeconds: Number(cycleSeconds),
        typeSpeedMs: Number(typeSpeedMs),
      }

      // What a step can land on, so a control is shown exactly when its effect can
      // actually run -- an empty pool falls back to the fixed effect.
      var attemptedEffects = activeEffects(normalizeSettings(draft))
      // Counted off the textarea, not off the cleaned list: a reader who typed past
      // the cap should see how far past it they are.
      var phraseCount = countPhrases(text)

      /** One edit: it freezes the draft against a late host read and retires the last notice. */
      function touch() {
        touchedRef.current = true
        setNotice(null)
      }

      /** Show the document the host accepted, its own clamping included. */
      function adopt(settings) {
        setEnabled(settings.enabled)
        setText(settings.phrases.join('\n'))
        setRandom(settings.random)
        setGlitch(settings.glitch)
        setGlitchChance(String(settings.glitchChance))
        setEffect(settings.effect)
        setEffectPool(settings.effectPool.slice())
        setRandomEffect(settings.randomEffect)
        setDecodeStyles(settings.decodeStyles.slice())
        setDecodeSpeedMs(String(settings.decodeSpeedMs))
        setCycleSeconds(String(settings.cycleSeconds))
        setTypeSpeedMs(String(settings.typeSpeedMs))
      }

      // Opening the page seeds the draft from this browser's own copy, which can
      // be older than the host document (another browser, or a first visit whose
      // defaults would otherwise be saved over it). Reading on every mount --
      // sharing the activation read while it is still in flight -- converges the
      // page, while an edited draft stays the reader's.
      useEffect(function () {
        var alive = true
        void loadFromHost().then(function () {
          if (!alive || touchedRef.current) return
          adopt(currentSettings)
        })
        return function () { alive = false }
      }, [])

      async function commit() {
        if (busy) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          var result = await saveSettings(draft)
          adopt(result.settings)
          setNotice(result.localOnly ? t('form.localOnly') : t('form.saved'))
        } catch (problem) {
          setError(String(problem !== null && problem !== undefined && problem.message !== undefined ? problem.message : problem))
        } finally {
          setBusy(false)
        }
      }

      function reset() {
        touchedRef.current = true
        setEnabled(DEFAULT_SETTINGS.enabled)
        setText(DEFAULT_SETTINGS.phrases.join('\n'))
        setRandom(DEFAULT_SETTINGS.random)
        setGlitch(DEFAULT_SETTINGS.glitch)
        setGlitchChance(String(DEFAULT_SETTINGS.glitchChance))
        setEffect(DEFAULT_SETTINGS.effect)
        setEffectPool(DEFAULT_SETTINGS.effectPool.slice())
        setRandomEffect(DEFAULT_SETTINGS.randomEffect)
        setDecodeStyles(DEFAULT_SETTINGS.decodeStyles.slice())
        setDecodeSpeedMs(String(DEFAULT_SETTINGS.decodeSpeedMs))
        setCycleSeconds(String(DEFAULT_SETTINGS.cycleSeconds))
        setTypeSpeedMs(String(DEFAULT_SETTINGS.typeSpeedMs))
        setNotice(null)
        setError(null)
      }

      return h('div', {
        'data-thinking-phrase': 'settings',
        style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '560px', paddingBottom: '4px' },
      },
      h('div', null,
        h('div', { style: { fontSize: '13px', fontWeight: 600 } }, t('page.title')),
        h('div', {
          style: { marginTop: '4px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
        }, t('page.intro'))),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
        h('span', { style: { fontSize: '13px' } }, t('form.enabled')),
        h(Switch, {
          checked: enabled,
          label: t('form.enabled'),
          onChange: function (next) { touch(); setEnabled(next) },
        })),
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('span', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' } },
          h('span', { style: { fontSize: '12px', fontWeight: 500 } }, t('form.phrases')),
          h('span', {
            role: 'status',
            style: {
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
              color: phraseCount > MAX_PHRASES ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)',
            },
          }, phraseCount > MAX_PHRASES
            ? t('form.phrasesOver', { count: phraseCount, max: MAX_PHRASES })
            : t('form.phrasesCount', { count: phraseCount, max: MAX_PHRASES }))),
        h('textarea', {
          value: text,
          rows: 6,
          placeholder: t('form.phrasesPlaceholder'),
          onChange: function (event) { touch(); setText(event.target.value) },
          style: {
            width: '100%', minHeight: '104px', maxHeight: '220px', resize: 'vertical',
            boxSizing: 'border-box', padding: '8px 9px', borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px',
          },
        }),
        h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.phrasesHint', { max: MAX_PHRASES }))),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
          h('span', { style: { fontSize: '13px' } }, t('form.random')),
          h(Switch, {
            checked: random,
            label: t('form.random'),
            onChange: function (next) { touch(); setRandom(next) },
          })),
        h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.randomHint'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
          h('span', { style: { fontSize: '13px' } }, t('form.glitch')),
          h(Switch, {
            checked: glitch,
            label: t('form.glitch'),
            onChange: function (next) { touch(); setGlitch(next) },
          })),
        h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.glitchHint')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '4px' } },
          h(NumberField, {
            label: t('form.glitchChance'), min: 0, max: 100, value: glitchChance, unit: '%',
            onChange: function (value) { touch(); setGlitchChance(value) },
          }),
          h('button', {
            type: 'button',
            onClick: function () { glitchProbeRef.current = Date.now() },
            style: {
              flex: 'none', padding: '3px 10px', borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
              color: 'var(--dsw-alias-label-secondary)', fontSize: '11px',
              fontFamily: 'inherit', cursor: 'pointer',
            },
          }, t('form.glitchTry')))),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
          h('span', { style: { fontSize: '13px' } }, t('form.randomEffect')),
          h(Switch, {
            checked: randomEffect,
            label: t('form.randomEffect'),
            onChange: function (next) { touch(); setRandomEffect(next) },
          })),
        h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.randomEffectHint'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('span', { style: { fontSize: '12px', fontWeight: 500 } }, randomEffect ? t('form.effectPool') : t('form.effect')),
        h('div', {
          role: 'group',
          'aria-label': randomEffect ? t('form.effectPool') : t('form.effect'),
          style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '3px', borderRadius: '9px', background: 'var(--dsw-alias-bg-layer-1)' },
        }, EFFECTS.map(function (id) {
          var checked = randomEffect ? effectPool.indexOf(id) !== -1 : effect === id
          return h(EffectButton, {
            key: id,
            selected: checked,
            onClick: function () {
              touch()
              if (!randomEffect) {
                setEffect(id)
                return
              }
              var present = effectPool.indexOf(id)
              setEffectPool(present === -1
                ? EFFECTS.filter(function (candidate) { return candidate === id || effectPool.indexOf(candidate) !== -1 })
                : effectPool.filter(function (candidate) { return candidate !== id }))
            },
          }, t('effect.' + id))
        })),
        randomEffect ? h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.effectPoolHint')) : null,
        randomEffect && effectPool.length === 0
          ? h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary)' } }, t('form.effectPoolEmpty'))
          : null),
      // The decode settings sit right under the chips that pick the effect, since
      // they belong to that effect rather than to the rotation rhythm below.
      attemptedEffects.indexOf('decode') !== -1
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h('span', { style: { fontSize: '12px', fontWeight: 500 } }, t('form.decodeStyle')),
          h('div', {
            role: 'group',
            'aria-label': t('form.decodeStyle'),
            style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '3px', borderRadius: '9px', background: 'var(--dsw-alias-bg-layer-1)' },
          }, DECODE_STYLES.map(function (id) {
            return h(EffectButton, {
              key: id,
              selected: decodeStyles.indexOf(id) !== -1,
              onClick: function () {
                // One style must stay picked, so un-ticking the last one is a no-op
                // and must not be mistaken for an edit of the draft.
                if (decodeStyles.indexOf(id) !== -1 && decodeStyles.length === 1) return
                touch()
                setDecodeStyles(decodeStyles.indexOf(id) === -1
                  ? DECODE_STYLES.filter(function (candidate) { return candidate === id || decodeStyles.indexOf(candidate) !== -1 })
                  : decodeStyles.filter(function (candidate) { return candidate !== id }))
              },
            }, t('decodeStyle.' + id))
          })),
          h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, t('form.decodeStyleHint')),
          h(NumberField, {
            label: t('form.decodeSpeed'), min: 10, max: 300, value: decodeSpeedMs,
            unit: t('form.decodeSpeedUnit'), onChange: function (value) { touch(); setDecodeSpeedMs(value) },
          }))
        : null,
      h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' } },
        h(NumberField, {
          label: t('form.cycle'), min: 1, max: 60, value: cycleSeconds,
          unit: t('form.seconds'), onChange: function (value) { touch(); setCycleSeconds(value) },
        }),
        attemptedEffects.indexOf('typewriter') !== -1 || attemptedEffects.indexOf('terminal') !== -1
          ? h(NumberField, {
            label: t('form.typeSpeed'), min: 10, max: 300, value: typeSpeedMs,
            unit: t('form.msPerChar'), onChange: function (value) { touch(); setTypeSpeedMs(value) },
          }) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('span', { style: { fontSize: '12px', fontWeight: 500 } }, t('form.preview')),
        h(Preview, { settings: normalizeSettings(draft), t: t, probeRef: glitchProbeRef })),
      notice !== null ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, notice) : null,
      error !== null ? h('div', { role: 'alert', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, t('form.error') + error) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: reset,
          style: {
            marginRight: 'auto', border: 'none', background: 'transparent', padding: '4px 2px',
            cursor: busy ? 'default' : 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)',
          },
        }, t('form.reset')),
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: function () { void commit() },
          style: {
            padding: '5px 14px', borderRadius: '7px', border: 'none',
            background: 'var(--dsw-alias-brand-primary)', color: '#ffffff', fontSize: '12px',
            fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.75 : 1,
          },
        }, busy ? t('form.saving') : t('form.save'))))
    }

    // ── registration ──────────────────────────────────────────────────────
    function apply(ctx) {
      localeService = ctx.locale

      ctx.effect(function () {
        try {
          return ctx.locale.register(NS, { zh: zh, en: en })
        } catch (error) {
          return function () {}
        }
      }, 'dsh-thinking-phrase: locale')

      ctx.effect(installStyles, 'dsh-thinking-phrase: styles')

      ctx.effect(function () {
        var stop = startClock(tickRuntime)
        return function () {
          stop()
          var elements = document.querySelectorAll('[data-chat-running]')
          for (var i = 0; i < elements.length; i += 1) clearRuntimeElement(elements[i])
        }
      }, 'dsh-thinking-phrase: runtime clock')

      // The configuration page lives on this bundle's card in the sidebar's
      // Plugins page, keyed by the bundle's package name: DSH renders plugin
      // configuration there rather than in Settings, where a modal had to fight
      // the settings panel's own overlay layer.
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE_NAME,
          locale: NS,
        }, SettingsPage)
      })

      void loadFromHost()
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    /**
     * Test-only: the shared host read the configuration page waits on. It
     * resolves without a value, so a caller reads `currentSettings` after it.
     */
    exports.loadFromHost = loadFromHost
    /** Test-only view of the dictionaries handed to `ctx.locale.register`. */
    exports.COPY = { en: en, zh: zh }
    exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS
    exports.EFFECTS = EFFECTS
    exports.normalizeSettings = normalizeSettings
    exports.countPhrases = countPhrases
    exports.MAX_PHRASES = MAX_PHRASES
    exports.MAX_PHRASE_LENGTH = MAX_PHRASE_LENGTH
    exports.phrasesFromTextarea = phrasesFromTextarea
    exports.applyDuration = applyDuration
    exports.durationSeconds = durationSeconds
    exports.spinnerFrame = spinnerFrame
    exports.barFrame = barFrame
    exports.renderText = renderText
    exports.glitchText = glitchText
    exports.cleanEffects = cleanEffects
    exports.cleanDecodeStyles = cleanDecodeStyles
    exports.resolveEffect = resolveEffect
    exports.resolveDecodeStyle = resolveDecodeStyle
    exports.activeEffects = activeEffects
    exports.decodeText = decodeText
    exports.decodeRank = decodeRank
    exports.glitchAllowed = glitchAllowed
    exports.DEFAULT_DECODE_SPEED_MS = DEFAULT_DECODE_SPEED_MS
    exports.DECODE_STYLES = DECODE_STYLES
    exports.DECODE_STAGES = DECODE_STAGES
    exports.DECODE_HEX = DECODE_HEX
    exports.isFullWidthGlyph = isFullWidthGlyph
    exports.shouldGlitch = shouldGlitch
    exports.typingProgress = typingProgress
    exports.typingCount = typingCount
    exports.advanceGlitch = advanceGlitch
    exports.probeGlitch = probeGlitch
    exports.activePhraseIndex = activePhraseIndex
    exports.previewKey = previewKey
    exports.phraseIndexAt = phraseIndexAt
    exports.pickDifferentIndex = pickDifferentIndex
    exports.randomStep = randomStep
    exports.effectFrame = effectFrame
    exports.startClock = startClock
    exports.TICK_MS = TICK_MS
    exports.readDurationFromElement = readDurationFromElement
    exports.writeFrameToElement = writeFrameToElement
    exports.STYLE_TEXT = STYLE_TEXT
    return module.exports
  },
})
