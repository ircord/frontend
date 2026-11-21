import { useEventListener } from '@vueuse/core'
import { onScopeDispose, watch, type Ref } from 'vue'

type ElementRef = Readonly<Ref<HTMLElement | null>>
type ScrollDirection = 'up' | 'down'

interface TimelineScrollOptions {
  viewport: ElementRef
  content: ElementRef
  spacer: ElementRef
  rows: () => readonly { key: string }[]
  detached: () => boolean
  atBottom: Ref<boolean>
}

interface ReadingPosition {
  row: Element
  top: number
}

// scrollTop is fractional while scrollHeight and clientHeight are rounded.
const bottomTolerance = 1.5
const moveTolerance = 0.5
const scrollSettle = 200
const glideEase = 55
const glideLimit = 700

function bottom(viewport: HTMLElement) {
  return Math.max(0, viewport.scrollHeight - viewport.clientHeight)
}

function readingPosition(viewport: HTMLElement, content: HTMLElement): ReadingPosition | undefined {
  const top = viewport.getBoundingClientRect().top
  const children = content.children
  // The tail spacer participates in layout but is never a reading anchor.
  let start = 0
  let end = children.length - 1
  while (start < end) {
    const middle = (start + end) >>> 1
    if (children[middle]!.getBoundingClientRect().bottom <= top) start = middle + 1
    else end = middle
  }
  const row = children[start]
  if (row?.hasAttribute('data-message-id'))
    return { row, top: row.getBoundingClientRect().top - top }
}

/** Paging, following and jumps for chat's bounded, normal-flow history. Row geometry is needed
 * only when the list changes or the reader jumps to a message. */
export function useTimelineScroll(options: TimelineScrollOptions) {
  const { viewport, content, spacer, rows, detached, atBottom } = options
  let following = !detached()
  let knownTop = 0
  let knownBottom = 0
  let restore: ReadingPosition | undefined
  let pendingJump: string | undefined
  let spacerHeight = 0
  let glideFrame: number | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let pointerHeld = false
  let pointerScrolled = false
  let direction: ScrollDirection | undefined

  const followsLive = () => following && !detached()
  const userInteracting = () => pointerHeld || settleTimer !== undefined

  function remember(top: number, end: number) {
    knownTop = top
    knownBottom = end
    atBottom.value = followsLive() || (spacerHeight === 0 && end - top <= bottomTolerance)
  }

  function rememberViewport(view: HTMLElement) {
    remember(view.scrollTop, bottom(view))
  }

  function setSpacer(height: number) {
    const element = spacer.value
    if (!element || height === spacerHeight) return
    spacerHeight = height
    element.hidden = height === 0
    element.style.height = height ? `${height}px` : ''
  }

  function stopGlide() {
    if (glideFrame === undefined) return
    cancelAnimationFrame(glideFrame)
    glideFrame = undefined
    if (viewport.value) viewport.value.style.overflowAnchor = ''
  }

  function followToEnd(view: HTMLElement) {
    setSpacer(0)
    const end = bottom(view)
    if (Math.abs(view.scrollTop - end) > moveTolerance) view.scrollTop = end
    remember(view.scrollTop, end)
  }

  function scrollToEnd(smooth = false) {
    pendingJump = undefined
    following = !detached()
    const view = viewport.value
    if (!view) return
    if (!smooth) {
      stopGlide()
      followToEnd(view)
      return
    }
    if (glideFrame !== undefined) return
    setSpacer(0)
    rememberViewport(view)
    const started = performance.now()
    let previous = started
    // Native anchoring can snap a smooth scroll to the bottom when new rows arrive.
    view.style.overflowAnchor = 'none'
    const step = (now: number) => {
      const end = bottom(view)
      const gap = end - view.scrollTop
      if (Math.abs(gap) <= 1 || now - started >= glideLimit) {
        glideFrame = undefined
        view.style.overflowAnchor = ''
        followToEnd(view)
        return
      }
      const fraction = 1 - Math.exp(-Math.max(0, now - previous) / glideEase)
      previous = now
      view.scrollTop += Math.sign(gap) * Math.max(1, Math.abs(gap) * fraction)
      remember(view.scrollTop, end)
      glideFrame = requestAnimationFrame(step)
    }
    glideFrame = requestAnimationFrame(step)
  }

  function centerMessage(key: string) {
    const view = viewport.value
    const list = content.value
    const tail = spacer.value
    const row = list?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(key)}"]`)
    if (!view || !list || !row || !tail) return false

    stopGlide()
    following = false
    const rect = row.getBoundingClientRect()
    const viewTop = view.getBoundingClientRect().top
    const padding = getComputedStyle(list)
    const start = Number.parseFloat(padding.paddingBlockStart) || 0
    const end = Number.parseFloat(padding.paddingBlockEnd) || 0
    const target =
      view.scrollTop + rect.top - viewTop - (view.clientHeight + start - end - rect.height) / 2
    const lastBottom = tail.previousElementSibling?.getBoundingClientRect().bottom ?? rect.bottom
    const realHeight = lastBottom - viewTop + view.scrollTop + end
    // A message near the end can be centered even when there are no later messages.
    setSpacer(Math.max(0, Math.ceil(target + view.clientHeight - realHeight)))
    view.scrollTop = Math.max(0, target)
    rememberViewport(view)
    return true
  }

  function jumpToMessage(key: string) {
    pendingJump = undefined
    if (centerMessage(key)) return true
    if (rows().length === 0) pendingJump = key
    return false
  }

  function flushJump() {
    if (pendingJump === undefined || !centerMessage(pendingJump)) return false
    pendingJump = undefined
    return true
  }

  function reconcileLayout() {
    const view = viewport.value
    if (!view || !content.value) return
    if (userInteracting() || !followsLive() || glideFrame !== undefined) rememberViewport(view)
    else followToEnd(view)
  }

  function readerSettled() {
    if (flushJump()) return
    const view = viewport.value
    // A resize can record the new bottom before the corresponding scroll event is delivered.
    if (
      view &&
      direction === 'down' &&
      !detached() &&
      bottom(view) - view.scrollTop <= bottomTolerance
    )
      following = true
    direction = undefined
    reconcileLayout()
  }

  function waitForReader() {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      if (!pointerHeld) readerSettled()
    }, scrollSettle)
  }

  function userScrollIntent(next?: ScrollDirection) {
    direction = next
    if (next === 'up') following = false
    pendingJump = undefined
    stopGlide()
    waitForReader()
  }

  function onScroll() {
    const view = viewport.value
    if (!view) return 0
    const top = view.scrollTop
    const movement = top - knownTop
    // The size observers refresh the limit. Read it synchronously only when it can change a
    // follow decision, including a scrollbar drag that began without a pointer event.
    const end =
      top >= knownBottom - bottomTolerance || (followsLive() && movement < -moveTolerance)
        ? bottom(view)
        : knownBottom
    // A scrollbar drag can report only a scroll event. Moving up by the amount that layout
    // contracted is consistent with the browser maintaining its own anchor.
    if (-movement > Math.max(0, knownBottom - end) + moveTolerance && end - top > moveTolerance) {
      following = false
      if (direction !== 'up') userScrollIntent('up')
    } else if (movement > moveTolerance && (userInteracting() || end - top <= bottomTolerance)) {
      if (direction !== 'down') userScrollIntent('down')
    }
    if (pointerHeld && Math.abs(movement) > moveTolerance) pointerScrolled = true
    else if (settleTimer !== undefined) waitForReader()
    remember(top, end)
    return top
  }

  function hold() {
    pointerHeld = true
    pointerScrolled = false
    stopGlide()
  }

  function release() {
    if (!pointerHeld) return
    pointerHeld = false
    if (pointerScrolled) {
      pendingJump = undefined
      waitForReader()
    } else if (settleTimer === undefined) readerSettled()
  }

  // Snapshot only before Vue moves rows, including a forward page that evicts earlier ones.
  watch(
    rows,
    () => {
      const view = viewport.value
      const list = content.value
      restore =
        view && list && (!followsLive() || userInteracting())
          ? readingPosition(view, list)
          : undefined
    },
    { flush: 'pre' },
  )

  watch(
    [content, rows],
    ([list], [previousList]) => {
      const view = viewport.value
      const anchor = restore
      restore = undefined
      if (!view || !list) return
      if (!userInteracting() && flushJump()) return
      if (list !== previousList) {
        spacerHeight = 0
        scrollToEnd()
        return
      }
      if (anchor && list.contains(anchor.row)) {
        const delta =
          anchor.row.getBoundingClientRect().top - view.getBoundingClientRect().top - anchor.top
        if (Math.abs(delta) > moveTolerance) view.scrollTop += delta
      }
      reconcileLayout()
    },
    { flush: 'post' },
  )

  watch(detached, (away) => {
    if (away) following = false
  })

  watch(
    [viewport, content],
    ([view, list], _, cleanup) => {
      if (!view || !list) return
      let frame: number | undefined
      const observer = new ResizeObserver(() => {
        if (frame !== undefined) return
        // A follow update can trim or reveal cached rows. Let resize delivery finish first.
        frame = requestAnimationFrame(() => {
          frame = undefined
          reconcileLayout()
        })
      })
      observer.observe(view)
      observer.observe(list)
      cleanup(() => {
        observer.disconnect()
        if (frame !== undefined) cancelAnimationFrame(frame)
      })
    },
    { flush: 'post' },
  )

  const pointerRelease = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') release()
  }
  const touchRelease = (event: TouchEvent) => {
    if (!event.touches.length) release()
  }
  useEventListener(window, 'pointerup', pointerRelease, { passive: true })
  useEventListener(window, 'pointercancel', pointerRelease, { passive: true })
  useEventListener(window, 'touchend', touchRelease, { passive: true })
  useEventListener(window, 'touchcancel', touchRelease, { passive: true })
  useEventListener(window, 'blur', release)
  onScopeDispose(() => {
    stopGlide()
    clearTimeout(settleTimer)
  })

  return { hold, jumpToMessage, onScroll, scrollToEnd, userInteracting, userScrollIntent }
}
