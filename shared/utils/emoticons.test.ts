import assert from 'node:assert/strict'
import test from 'node:test'
import { convertTrailingEmoticon, emoticons, finishedEmoticon, insideCode } from './emoticons'

const at = (text: string) => finishedEmoticon(text, text.length)

test('the emoticons from the request convert after a space', () => {
  for (const [typed, emoji] of [
    [':)', '🙂'],
    [':(', '🙁'],
    [':D', '😄'],
    [':P', '😛'],
    [':O', '😮'],
    [';)', '😉'],
    [':X', '🤐'],
    ['<3', '❤️'],
  ] as const)
    assert.deepEqual(at(`${typed} `), { start: 0, text: typed, emoji })
})

test('every listed emoticon converts after a space or a line break', () => {
  for (const [typed, emoji] of Object.entries(emoticons)) {
    assert.equal(at(`hi ${typed} `)?.emoji, emoji, typed)
    assert.equal(at(`hi ${typed}\n`)?.emoji, emoji, typed)
  }
})

test('the longest emoticon wins', () => {
  assert.deepEqual(at('hi :-D '), { start: 3, text: ':-D', emoji: '😄' })
  assert.deepEqual(at('a </3 '), { start: 2, text: '</3', emoji: '💔' })
  assert.deepEqual(at('hi >:-( '), { start: 3, text: '>:-(', emoji: '😠' })
})

test('the caret can sit before later text', () => {
  assert.deepEqual(finishedEmoticon('a :D  b', 5), { start: 2, text: ':D', emoji: '😄' })
})

test('an emoticon needs the whitespace typed right after it', () => {
  assert.equal(at(':)'), null)
  assert.equal(at(':)  '), null)
})

test('emoticons inside a word or URL stay as typed', () => {
  assert.equal(at('word:( '), null)
  assert.equal(at('https://x.dev/:) '), null)
  assert.equal(at('see http:/ '), null)
  assert.equal(at('ratio 1:D '), null)
  assert.equal(at('a<3 '), null)
})

test('emoticons inside code stay as typed', () => {
  assert.equal(at('```\ncode :) '), null)
  assert.equal(at('```js\n:D '), null)
  assert.equal(at('hi `code :) '), null)
  assert.equal(at('a `b` c :) ')?.emoji, '🙂')
  assert.equal(at('```\nx\n```\n:D ')?.emoji, '😄')
})

test('look-alikes from ordinary text are not emoticons', () => {
  assert.equal(at('D: '), null)
  assert.equal(at('B) '), null)
  assert.equal(at(':S '), null)
})

test('inline code is counted per line', () => {
  assert.equal(insideCode('`a\nb', 4), false)
  assert.equal(insideCode('x `a', 4), true)
})

test('sending converts a final emoticon once', () => {
  assert.equal(convertTrailingEmoticon('hi :)'), 'hi 🙂')
  assert.equal(convertTrailingEmoticon('<3'), '❤️')
  assert.equal(convertTrailingEmoticon('/me waves :D'), '/me waves 😄')
  assert.equal(convertTrailingEmoticon('hi 🙂'), 'hi 🙂')
  assert.equal(convertTrailingEmoticon('hi :) '), 'hi :) ')
  assert.equal(convertTrailingEmoticon('foo:D'), 'foo:D')
  assert.equal(convertTrailingEmoticon('see `:)'), 'see `:)')
  assert.equal(convertTrailingEmoticon('```\n:D'), '```\n:D')
})
