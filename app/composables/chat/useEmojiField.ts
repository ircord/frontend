import type { EmojiItem } from '../../../shared/types/media'

/** A custom emoji written as text, the same pattern messages render. */
const SHORTCODE = /:([\w+-]{1,64}):/g

/**
 * Turns a contenteditable element into the message box's text field: server emoji show as images,
 * while the element keeps a textarea's `value`, `selectionStart`, `selectionEnd`,
 * `selectionDirection` and `setSelectionRange`, counted in plain-text characters (an image counts
 * as its `:name:`). The composer's caret, autocomplete and shortcut code then works unchanged, and
 * the draft stays the text that is sent.
 *
 * The element holds only text, emoji images and line breaks. A final `<br>` is the browser's
 * placeholder for an empty or trailing line and counts as nothing.
 */
export function useEmojiField(
  field: Ref<HTMLElement | null>,
  draft: Ref<string> | WritableComputedRef<string>,
  maxLength: number,
) {
  const media = useMediaStore()
  const appearance = useAppearanceStore()
  /** The selection while the field doesn't have it, like a textarea remembers its own. */
  let saved = { start: 0, end: 0, backward: false }

  const emojiOf = (name: string): EmojiItem | undefined => {
    const item = media.byShortcode.get(name)
    return item?.url ? item : undefined
  }
  function image(name: string, item: EmojiItem) {
    const img = document.createElement('img')
    img.className = 'composer-emoji inline-custom-emoji'
    img.dataset.emoji = `:${name}:`
    img.alt = `:${name}:`
    img.draggable = false
    img.referrerPolicy = 'no-referrer'
    img.src = appearance.animate ? item.url! : item.staticUrl || item.url!
    return img
  }
  const isEmoji = (node: Node): node is HTMLImageElement =>
    node instanceof HTMLImageElement && !!node.dataset.emoji
  /**
   * A line break typed last arrives as two: Chrome keeps an extra "\n" at the very end so the new
   * line shows. Like a final `<br>`, it counts as nothing.
   */
  const textOf = (node: Text, parent: Node) =>
    node === parent.lastChild && parent === field.value ? node.data.replace(/\n$/, '') : node.data
  /** How many characters of the text a top-level node stands for. */
  function size(el: HTMLElement, node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return textOf(node as Text, el).length
    if (isEmoji(node)) return node.dataset.emoji!.length
    if (node.nodeName === 'BR') return node === el.lastChild ? 0 : 1
    return text(node).length
  }
  /** The text of any content, including what the browser inserted before it was tidied. */
  function text(node: Node): string {
    let out = ''
    node.childNodes.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) out += textOf(child as Text, node)
      else if (isEmoji(child)) out += child.dataset.emoji
      else if (child.nodeName === 'BR') out += child === node.lastChild ? '' : '\n'
      else if (child.nodeName === 'IMG') out += (child as HTMLImageElement).alt
      else {
        if (/^(DIV|P)$/.test(child.nodeName) && index > 0) out += '\n'
        out += text(child)
      }
    })
    return out
  }
  function render(el: HTMLElement, value: string) {
    const nodes: Node[] = []
    let last = 0
    for (const match of value.matchAll(SHORTCODE)) {
      const item = emojiOf(match[1]!)
      if (!item) continue
      if (match.index > last) nodes.push(document.createTextNode(value.slice(last, match.index)))
      nodes.push(image(match[1]!, item))
      last = match.index + match[0].length
    }
    if (last < value.length) nodes.push(document.createTextNode(value.slice(last)))
    // A trailing line break only shows with something after it.
    if (value.endsWith('\n')) nodes.push(document.createElement('br'))
    el.replaceChildren(...nodes)
  }
  const tidy = (el: HTMLElement) =>
    [...el.childNodes].every(
      (node) => node.nodeType === Node.TEXT_NODE || isEmoji(node) || node.nodeName === 'BR',
    )
  /** Whether rendering would turn some written `:name:` into an image. */
  const convertible = (el: HTMLElement) =>
    [...el.childNodes].some(
      (node) =>
        node.nodeType === Node.TEXT_NODE &&
        [...(node as Text).data.matchAll(SHORTCODE)].some((match) => emojiOf(match[1]!)),
    )

  function offsetOf(el: HTMLElement, node: Node, offset: number) {
    let total = 0
    if (node === el) {
      for (let i = 0; i < offset; i++) total += size(el, el.childNodes[i]!)
      return total
    }
    for (const child of el.childNodes) {
      if (child === node) return total + (node.nodeType === Node.TEXT_NODE ? offset : 0)
      if (child.contains(node)) {
        // Markup the browser added (pasted lines) is measured as the text before the point.
        const range = document.createRange()
        range.setStart(child, 0)
        range.setEnd(node, offset)
        const before = document.createElement('div')
        before.append(range.cloneContents(), document.createElement('br'))
        return total + text(before).length
      }
      total += size(el, child)
    }
    return total
  }
  /** Where an offset falls; inside an image's `:name:` it lands after the image. */
  function pointAt(el: HTMLElement, offset: number): [Node, number] {
    let total = 0
    const children = [...el.childNodes]
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      const length = size(el, child)
      if (child.nodeType === Node.TEXT_NODE && offset <= total + length)
        return [child, offset - total]
      if (offset <= total) return [el, i]
      if (offset < total + length) return [el, i + 1]
      total += length
    }
    const tail = el.lastChild?.nodeName === 'BR' ? 1 : 0
    return [el, children.length - tail]
  }
  function current(el: HTMLElement) {
    const selection = window.getSelection()
    if (!selection?.anchorNode || !el.contains(selection.anchorNode)) return saved
    const anchor = offsetOf(el, selection.anchorNode, selection.anchorOffset)
    const focus = offsetOf(el, selection.focusNode!, selection.focusOffset)
    return {
      start: Math.min(anchor, focus),
      end: Math.max(anchor, focus),
      backward: focus < anchor,
    }
  }
  function select(el: HTMLElement, start: number, end: number, backward = false) {
    const length = text(el).length
    saved = {
      start: Math.max(0, Math.min(start, length)),
      end: Math.max(0, Math.min(end, length)),
      backward,
    }
    if (document.activeElement !== el) return
    const [a, aOffset] = pointAt(el, backward ? saved.end : saved.start)
    const [f, fOffset] = pointAt(el, backward ? saved.start : saved.end)
    window.getSelection()?.setBaseAndExtent(a, aOffset, f, fOffset)
  }
  /** Re-renders from the text, keeping the caret where it was in the text. */
  function rerender(el: HTMLElement, value = text(el)) {
    const focused = document.activeElement === el
    const { start, end, backward } = focused ? current(el) : saved
    render(el, value)
    select(el, start, end, backward)
  }

  /** Typing the closing colon of a server emoji swaps it for the image, as one undoable step. */
  function convertTyped(el: HTMLElement) {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || node.parentNode !== el)
      return false
    const at = selection.anchorOffset
    const match = /:([\w+-]{1,64}):$/.exec((node as Text).data.slice(0, at))
    const item = match && emojiOf(match[1]!)
    if (!item) return false
    const range = document.createRange()
    range.setStart(node, at - match[0].length)
    range.setEnd(node, at)
    selection.removeAllRanges()
    selection.addRange(range)
    return document.execCommand('insertHTML', false, image(match[1]!, item).outerHTML)
  }

  function onInput(event: Event) {
    const el = field.value!
    if (!(event as InputEvent).isComposing) {
      if (!tidy(el) || ((event as InputEvent).inputType !== 'insertText' && convertible(el)))
        rerender(el)
      else if (convertTyped(el)) return
      // The browser drops the final line break's placeholder when the field empties or a line
      // break is typed last; put it back so the caret has a line to sit on.
      const value = text(el)
      const tail = el.lastChild?.nodeName === 'BR'
      if (value.endsWith('\n') !== tail || (!value && el.childNodes.length)) rerender(el, value)
    }
    draft.value = text(el)
  }
  function onBeforeInput(event: InputEvent) {
    const el = field.value!
    // Shift+Enter keeps the browser's own line break (a <br>), which undo knows about. A new
    // paragraph would add block elements; Enter sends instead (ChatComposer).
    if (event.inputType === 'insertParagraph') {
      event.preventDefault()
      return
    }
    if (event.inputType === 'insertFromDrop') {
      event.preventDefault()
      const dropped = event.dataTransfer?.getData('text/plain')
      if (dropped) document.execCommand('insertText', false, dropped)
      return
    }
    const added = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
    if (added && !event.isComposing) {
      const { start, end } = current(el)
      if (text(el).length - (end - start) + added.length > maxLength) event.preventDefault()
    }
  }
  /** Pasted rich text arrives as plain text; the composer's own paste handling runs first. */
  function onPaste(event: ClipboardEvent) {
    if (event.defaultPrevented) return
    event.preventDefault()
    const pasted = event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n')
    if (pasted) document.execCommand('insertText', false, pasted)
  }
  /** Copying a selection copies its text, with emoji as `:name:`. */
  function onCopy(event: ClipboardEvent) {
    const el = field.value!
    const { start, end } = current(el)
    if (start === end || !event.clipboardData) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', text(el).slice(start, end))
    if (event.type === 'cut') document.execCommand('delete')
  }
  function onSelectionChange() {
    const el = field.value
    const selection = window.getSelection()
    if (el && selection?.anchorNode && el.contains(selection.anchorNode)) saved = current(el)
  }
  /** Focus returns to the remembered caret, as a textarea's does (keyboard focus, shortcuts). */
  function onFocus() {
    const el = field.value!
    const selection = window.getSelection()
    if (!selection?.anchorNode || !el.contains(selection.anchorNode))
      select(el, saved.start, saved.end, saved.backward)
  }

  function install(el: HTMLElement) {
    Object.defineProperties(el, {
      value: {
        configurable: true,
        get: () => text(el),
        set: (value: string) => rerender(el, value),
      },
      selectionStart: { configurable: true, get: () => current(el).start },
      selectionEnd: { configurable: true, get: () => current(el).end },
      selectionDirection: {
        configurable: true,
        get: () => (current(el).backward ? 'backward' : 'forward'),
      },
      setSelectionRange: {
        configurable: true,
        value: (start: number, end: number, direction?: string) =>
          select(el, start, end, direction === 'backward'),
      },
      disabled: { configurable: true, get: () => false },
    })
    saved = { start: draft.value.length, end: draft.value.length, backward: false }
    render(el, draft.value)
    // Capture: the text is current before the composer's own input handler reads it.
    el.addEventListener('input', onInput, { capture: true })
    el.addEventListener('beforeinput', onBeforeInput)
    el.addEventListener('paste', onPaste)
    el.addEventListener('copy', onCopy)
    el.addEventListener('cut', onCopy)
    el.addEventListener('focus', onFocus)
  }
  watch(
    field,
    (el, previous) => {
      if (previous) {
        previous.removeEventListener('input', onInput, { capture: true })
        previous.removeEventListener('beforeinput', onBeforeInput)
        previous.removeEventListener('paste', onPaste)
        previous.removeEventListener('copy', onCopy)
        previous.removeEventListener('cut', onCopy)
        previous.removeEventListener('focus', onFocus)
      }
      if (el) {
        media.needCustom()
        install(el)
      }
    },
    { flush: 'sync' },
  )
  useEventListener(document, 'selectionchange', onSelectionChange)
  // Text set from outside (a conversation switch, a sent message, autocomplete) renders at once,
  // so a caret placed right after it lands in the new content.
  watch(
    draft,
    (value) => {
      const el = field.value
      if (el && value !== text(el)) rerender(el, value)
    },
    { flush: 'sync' },
  )
  // Emoji that load (or change) after the text was written still turn into images.
  watch([() => media.byShortcode, () => appearance.animate], () => {
    const el = field.value
    if (el) rerender(el)
  })
}
