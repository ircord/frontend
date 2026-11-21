// Signed-out, in-memory fixture using the production pager and normal-flow scroll engine.
// It runs inside the app's browser bundle: start `bun run dev`, then run
// `node scripts/verify-history-scroll-browser.mjs`. Bun cannot run it directly.
import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'
import { useTimelineScroll } from '../app/composables/chat/useTimelineScroll'
import { createHistoryPagination } from '../app/utils/history-pagination'
import { boundaryMessage, messageBoundary } from '../shared/utils/history-cursor'
import timelineSource from '../app/components/chat/ChatTimeline.vue?raw'

export async function verifyHistoryScroll() {
  const retained = Array.from({ length: 1200 }, (_, index) => ({
    id: `fixture-${String(index).padStart(4, '0')}`,
    conversationId: 'fixture-room',
    senderId: 'fixture-peer',
    kind: 'message',
    text: `Fixture ${index}`,
    createdAt: new Date(index * 1000).toISOString(),
    reactions: [],
  }))
  function read(query) {
    const at = query.around
      ? retained.findIndex((item) => item.id === query.around)
      : query.before
        ? retained.findIndex((item) => item.id === boundaryMessage(query.before))
        : retained.length
    const start = query.around
      ? Math.max(0, at - Math.floor((query.limit - 1) / 2))
      : Math.max(0, at - query.limit)
    const end = query.around
      ? Math.min(retained.length, at + Math.ceil((query.limit - 1) / 2) + 1)
      : at
    return {
      items: retained.slice(start, end),
      nextCursor: start ? messageBoundary(retained[start].id) : null,
      hasNewer: !!query.around && end < retained.length,
      cursor: 1,
    }
  }
  const page = ref(read({ limit: 500 })),
    loading = ref()
  const rows = computed(() => [
    ...(loading.value === 'older' ? [{ key: 'loading' }] : []),
    ...page.value.items.map((item) => ({ key: item.id, text: item.text })),
  ])
  const atBottom = ref(true)
  let engine,
    viewport,
    maximumAnchorError = 0,
    oldPages = 0,
    newPages = 0
  const seen = new Set(page.value.items.map((item) => item.id))
  const check = (ok, message) => {
    if (!ok) throw new Error(message)
  }
  const pager = createHistoryPagination({
    pageSize: 40,
    limit: 500,
    get: () => page.value,
    set: (_, value) => {
      page.value = value
      for (const item of value.items) seen.add(item.id)
      check(value.items.length <= 500, 'Timeline exceeded its 500-message bound')
    },
    read: async (_, query) => {
      await nextTick()
      return read(query)
    },
    changed: (direction) => {
      loading.value = direction
    },
    report: (error) => {
      throw error
    },
  })
  const Root = defineComponent({
    setup() {
      const view = ref(null)
      const content = ref(null)
      const spacer = ref(null)
      engine = useTimelineScroll({
        viewport: view,
        content,
        spacer,
        rows: () => rows.value,
        detached: () => !!page.value.detached,
        atBottom,
      })
      return () =>
        h(
          'div',
          {
            ref: view,
            id: 'fixture-timeline',
            onScroll: engine.onScroll,
            style: {
              height: '240px',
              width: '500px',
              overflow: 'auto',
              overflowAnchor: 'none',
            },
          },
          [
            h('div', { ref: content }, [
              ...rows.value.map((item) =>
                h(
                  'div',
                  {
                    key: item.key,
                    'data-message-id': item.key,
                    style: {
                      height:
                        item.key === 'loading'
                          ? '36px'
                          : `${28 + (Number(item.key.slice(-4)) % 3) * 4}px`,
                    },
                  },
                  item.text,
                ),
              ),
              ...(loading.value === 'newer'
                ? [h('div', { style: { height: '36px' } }, 'Loading')]
                : []),
              h('div', { ref: spacer, hidden: true, key: 'spacer' }),
            ]),
          ],
        )
    },
  })
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    top: '60px',
    left: '20px',
    zIndex: '2147483640',
    background: '#222',
    color: '#eee',
  })
  document.body.append(host)
  const app = createApp(Root)
  const settle = async () => {
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }
  const firstVisible = () => {
    const top = viewport.getBoundingClientRect().top
    return [...viewport.querySelectorAll('[data-message-id]')].find(
      (row) => row.getBoundingClientRect().bottom > top,
    )
  }
  const position = async (top) => {
    engine.userScrollIntent()
    viewport.scrollTop = top
    engine.onScroll()
    await settle()
  }
  async function advance(direction) {
    const anchor = firstVisible(),
      before = anchor.getBoundingClientRect().top
    check(await pager.load('fixture-room', direction), `Could not load ${direction} page`)
    await settle()
    check(anchor.isConnected, 'Paging removed the visible anchor')
    const error = Math.abs(anchor.getBoundingClientRect().top - before)
    maximumAnchorError = Math.max(maximumAnchorError, error)
    check(error <= 1, `${direction} paging moved the visible anchor by ${error}px`)
  }
  try {
    app.mount(host)
    viewport = host.querySelector('#fixture-timeline')
    await settle()
    while (page.value.nextCursor) {
      await position(120)
      await advance('older')
      check(++oldPages < 50, 'Older pagination did not finish')
    }
    check(page.value.items[0].id === retained[0].id, 'Could not reach the retained beginning')
    // Exercise the timeline's actual edge-selection function with the production pager.
    // Fetch the adjacent page while the reader still has history ahead to scroll through.
    const edgeStart = timelineSource.indexOf('function pageNearEdge() {')
    const edgeEnd = timelineSource.indexOf('\nasync function older()', edgeStart)
    check(edgeStart >= 0 && edgeEnd > edgeStart, 'Timeline edge selector was not found')
    let pendingNewer
    const pageNearEdge = new Function(
      'scroller',
      'paging',
      'history',
      'newerFailed',
      'pageDirection',
      'newer',
      'older',
      `${timelineSource.slice(edgeStart, edgeEnd)}; return pageNearEdge`,
    )(
      { value: viewport },
      () => !!loading.value,
      { data: page },
      { value: false },
      'newer',
      () => {
        pendingNewer = pager.load('fixture-room', 'newer')
      },
      () => {
        throw new Error('Bottom edge selected older history')
      },
    )
    await position(viewport.scrollHeight - viewport.clientHeight - 800)
    const previousLast = page.value.items.at(-1).id
    pageNearEdge()
    check(pendingNewer, 'The older window did not request newer history before its bottom')
    check(await pendingNewer, 'The newer history request did not complete')
    await settle()
    check(page.value.items.at(-1).id > previousLast, 'Newer history did not advance')
    check(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 200,
      'Fetching newer history skipped the appended messages',
    )
    newPages++
    while (page.value.hasNewer) {
      await position(viewport.scrollHeight - viewport.clientHeight - 120)
      await advance('newer')
      check(
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 200,
        'Historical paging jumped past the newly appended messages',
      )
      check(++newPages < 50, 'Newer pagination did not finish')
    }
    check(
      page.value.items.at(-1).id === retained.at(-1).id,
      'Could not scroll back to the latest retained message',
    )
    check(!page.value.detached, 'The authoritative latest page did not reattach')
    check(seen.size === retained.length, 'Bidirectional travel skipped retained messages')
    engine.scrollToEnd()
    await settle()
    check(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1,
      'Following latest failed after reattaching',
    )
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    // A gentle upward swipe must stay detached through a new arrival.
    engine.userScrollIntent('up')
    viewport.scrollTop -= 12
    engine.onScroll()
    await pause(250)
    check(!atBottom.value, 'Gentle upward scrolling did not detach')
    const beforeArrival = viewport.scrollTop
    page.value = {
      ...page.value,
      items: [
        ...page.value.items,
        {
          ...retained.at(-1),
          id: 'fixture-arrival',
          createdAt: new Date(1200000).toISOString(),
        },
      ],
    }
    await settle()
    await pause(250)
    check(Math.abs(viewport.scrollTop - beforeArrival) <= 1, 'A new message pulled the reader down')
    // Simulate a resize observer recording the final position before the scroll event, and
    // independently rounded DOM dimensions leaving a subpixel residual at the physical end.
    engine.userScrollIntent('down')
    viewport.scrollTop = viewport.scrollHeight
    viewport.style.width = '510px'
    await settle()
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight.call(viewport) + 0.75,
    })
    engine.onScroll()
    await pause(250)
    check(atBottom.value, 'Jump control remained at the physical bottom')
    delete viewport.scrollHeight
    const beforeFollowingArrival = viewport.scrollTop
    page.value = {
      ...page.value,
      items: [
        ...page.value.items,
        {
          ...retained.at(-1),
          id: 'fixture-following',
          createdAt: new Date(1201000).toISOString(),
        },
      ],
    }
    await settle()
    await pause(250)
    check(viewport.scrollTop > beforeFollowingArrival, 'A downward return did not resume following')
    check(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1,
      'Following did not reach the new message',
    )
    const target = page.value.items[100].id
    check(engine.jumpToMessage(target), 'Could not jump to a native row')
    await settle()
    const item = viewport.querySelector(`[data-message-id="${target}"]`).getBoundingClientRect()
    const frame = viewport.getBoundingClientRect()
    check(
      Math.abs(item.top + item.height / 2 - (frame.top + frame.height / 2)) <= 1,
      'Jump did not center the native row',
    )
    // Native scrolling through a stable page must leave row layout to the browser.
    const getBounds = Element.prototype.getBoundingClientRect
    let rowMeasurements = 0
    let heightReads = 0
    Element.prototype.getBoundingClientRect = function () {
      if (viewport.contains(this) && this.hasAttribute('data-message-id')) rowMeasurements++
      return getBounds.call(this)
    }
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      get: () => {
        heightReads++
        return scrollHeight.call(viewport)
      },
    })
    try {
      for (let i = 0; i < 12; i++) {
        viewport.scrollTop -= 32
        await settle()
      }
      await pause(250)
    } finally {
      Element.prototype.getBoundingClientRect = getBounds
      delete viewport.scrollHeight
    }
    check(rowMeasurements === 0, `Scrolling measured ${rowMeasurements} rows`)
    check(heightReads <= 2, `Scrolling repeatedly read the viewport extent (${heightReads} reads)`)

    const last = page.value.items.at(-1).id
    check(engine.jumpToMessage(last), 'Could not jump to the last row')
    await settle()
    const tailRow = viewport.querySelector(`[data-message-id="${last}"]`)
    const tail = tailRow.getBoundingClientRect()
    check(
      Math.abs(tail.top + tail.height / 2 - (frame.top + frame.height / 2)) <= 1,
      'The last row did not center',
    )
    check(!atBottom.value, 'Centering the last row started following live chat')
    engine.scrollToEnd(true)
    await pause(750)
    check(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1,
      'The glide did not reach the latest row',
    )
    const beforeGrowth = viewport.scrollTop
    engine.hold()
    tailRow.style.height = '160px'
    await settle()
    check(viewport.scrollTop === beforeGrowth, 'A resize moved the timeline while held')
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }))
    await settle()
    check(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1,
      'Following did not catch up when the reader released the timeline',
    )
    viewport.scrollTop -= 12
    await settle()
    check(!atBottom.value, 'Scrolling without an input event did not leave live chat')
    return {
      retained: retained.length,
      visited: seen.size,
      oldPages,
      newPages,
      bound: 500,
      maximumAnchorError,
      rowMeasurements,
      heightReads,
      browserScrollAnchoring: 'disabled',
      followLatest: 'pass',
    }
  } finally {
    pager.cancel()
    app.unmount()
    host.remove()
  }
}
