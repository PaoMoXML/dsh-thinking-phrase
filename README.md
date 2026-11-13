# dsh-thinking-phrase

Customize the line that DSH shows while a model is thinking:

> 深度求索中，用时 3 秒 ···

The plugin replaces the text of the running status without touching the rest of
the Chat layout. Open **Plugins** in the sidebar, open this bundle's card, and
edit the **思考提示** section on it.

## What it offers

- Any number of one-line phrases; multiple phrases rotate while the model is
  thinking.
- Rotation is in list order, or the next phrase is drawn at random with the
  **随机挑选下一条** switch; a draw never repeats the phrase just shown.
- `{duration}` is replaced with the live elapsed time, for example
  `深度求索中，用时 {duration}` renders as `深度求索中，用时 3 秒`.
- Three more placeholders: `{seconds}` (whole seconds counted from the running
  clock, so a 65 second run reads 65 and not the 1 that the host's "1 分 5 秒"
  text starts with), `{spinner}` (a braille mark turning one frame per 100 ms)
  and `{bar}` (one `█` per second over eight cells, then held full). The spinner
  and the bar measure the whole running period, so a rotating phrase list still
  shows them moving.
- Nine effects: **默认** (static), **打字机** (typewriter), **命令行** (command
  line: the text types out behind a `_` cursor, `_` → `你_` → `你好_` → `你好啊`),
  **淡入** (fade), **上滑** (slide up), **揭幕** (wipe in from the left), **对焦**
  (focus in from a blur), **解码** (decode: every glyph waits its turn in a
  scattered order, fading through three noise stages before it reads as itself),
  **平移** (scroll: a line longer than the label it replaced sweeps sideways and
  back, measured in pixels on the live element, so the end stays readable).
- An optional **每条短语随机换效果** switch draws one of the ticked effects on
  every phrase switch, so one run mixes styles; a single tick just keeps that
  effect. Each running label seeds its own draw, so two labels do not replay the
  same sequence.
- **偶发错字自动修正** (glitch) is event-driven, not clock-driven: only a glyph
  the typing clock just revealed (typewriter, command line) or a phrase that just
  switched in may come out wrong, and it reads as a typo the line then corrects --
  a line that is already correct is never spoiled again, so a growing placeholder
  (`{duration}` turning 9 秒 into 10 秒) raises nothing. Each event draws against a
  configurable **概率** (0–100 %, default 35), and the draw belongs to that event
  rather than to the phrase, so one phrase does not flicker every time it comes
  round. A wrong glyph holds for 160 ms, the replacement keeps the code-point
  count, the first glyph and a command-line cursor are never spoiled, the first
  observation of a label only records its baseline, and a switch ends any typo the
  previous phrase was still showing. An effect that types spoils its first glyph on
  a switch; an effect that shows the whole line spoils two of them. The
  configuration page's **试一次** button forces one flicker on demand, even while
  the switch is off. It is off by default.
- Per-phrase dwell time and typewriter speed.
- A live preview in the configuration section.
- The preference document is stored at
  `$DSH_HOME/thinking-phrase/settings.json`; `localStorage` is a fallback when
  the host route is unavailable.

## Files

| Path | Role |
|---|---|
| `client.js` | Browser half: the configuration page on the Plugins card, runtime text replacement and animation clock |
| `index.js` | Host half: registers the two loopback-only preference routes |
| `lib/store.js` | JSON preference document with atomic writes |
| `lib/route.js` | `POST /thinking-phrase/config` and `POST /thinking-phrase/save` |
| `lib/loopback.js` | Same-origin/loopback request fence |

## Notes

The running label belongs to `@deepseek-ai/dsh-client-ui-chat` and has no
plugin slot. This plugin therefore hides TextShimmer's normal text child and
paints the configured line on the `[data-shimmer]` root, while feeding the
existing shimmer sweep the same text. The React tree is untouched. The
selector lives in `client.js`; a missing shimmer root clears the plugin's own
marker and leaves the original label visible instead of breaking Chat. That
check covers the root disappearing, not a change of the root's own display
mode, which the shared-cell rule below relies on.

TextShimmer's root is an inline-grid sized to its content, and the layer that
clips the shimmer sweep is pinned to that box. The hidden stock line and the
custom line therefore share one grid cell, so the box is as wide as the longer
of the two; painted out of flow, a custom line longer than the stock label (or
one rendered at a larger UI font) used to stop the sweep at the stock label's
end. A line wider than the container is still clipped to it -- unless the
**平移** effect is on, which takes the custom line out of flow so the box stays
at the stock width and the line can scroll inside it. Wipe, blur and scroll
apply the same geometry to the sweep copy, so the glow never runs over glyphs
the reader cannot see yet.

The settings document is not session data; deleting it only restores the
default `深度求索中，用时 {duration}` wording.
