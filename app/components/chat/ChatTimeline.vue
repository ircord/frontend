<script setup vapor lang="ts">
import { errorText } from '../../utils/api'
import { useQuery } from '@pinia/colada'
import type { Message } from '../../../shared/types/chat'
import { HISTORY_PAGE, messagesQuery } from '../../queries/chat'
import { parsePrefix, stripFormatting } from '../../../shared/utils/irc'
import { selectionLog } from '../../../shared/utils/log'
import { isEditable } from '../../../shared/utils/focus'
import { attractClock, offscreen, resolveAttract } from '../../../shared/utils/attract'
import { unseenSince, type SeenUpTo } from '../../../shared/utils/unseen'
import {
  createTimelineRows,
  firstMessageOf,
  type TimelineMessageRow,
} from '../../utils/timeline-rows'
const props = defineProps<{ highlightId?: string }>()
const emit = defineEmits<{
  reply: [message: Message]
  profile: [id: string]
}>()
const chat = useChatStore()
const conversationName = useSidebarOrder().name
/** The other person in a direct conversation, introduced at its start. */
const startPartner = computed(() =>
  chat.active?.kind === 'direct' && !chat.active.party
    ? chat.directPartner(chat.active)
    : undefined,
)
const { t, n, locale } = useI18n()
const { day, time } = useTimeFormat()
const history = useQuery(() => messagesQuery(chat.activeId))
/** Deleted (redacted) messages leave the timeline entirely; replies still quote them as deleted. */
const messages = computed(() => {
  const retained = chat.outbox[chat.activeId] ?? []
  const historyItems = history.data.value?.items ?? []
  const isConfirmed = (m: Message) => m.confirmed || (!m.unconfirmed && !!m.upstreamId)
  const confirmed = new Set(historyItems.filter(isConfirmed).map((m) => m.clientId))
  const unresolved = new Set(retained.map((m) => m.clientId))
  return [
    ...historyItems.filter((m) => isConfirmed(m) || !unresolved.has(m.clientId)),
    ...retained.filter((m) => !confirmed.has(m.clientId)),
  ].filter((message) => message.kind !== 'system' && !message.deleted)
})
const preferences = usePreferencesStore()
const appearance = useAppearanceStore()
const notifications = useNotificationStore()
const messageActions = useMessageActions()
const menus = useMenus(messageActions)
const touchMenu = useMediaQuery('(hover: none)')
const reactionId = ref('')
useViewHistory('timeline-reactions', reactionId)
// WKWebView can leave old selection paint on rows as they scroll back into view.
const skipOffscreenRows = usePlatform().titleBar !== 'macos'
/** A retained history window follows the reader, even when its current bottom is visible. */
const detached = computed(() => !!history.data.value?.detached || !!history.data.value?.hasNewer)
const scroller = useTemplateRef<HTMLElement>('viewport')
const content = useTemplateRef<HTMLElement>('content')
const spacer = useTemplateRef<HTMLElement>('spacer')
const atBottom = ref(true)
async function jumpToPresent() {
  const id = chat.activeId
  if ((await chat.returnToPresent(id)) && chat.activeId === id) scrollLatest()
}
/** The newest message when the reader left the latest one; the pill counts what came after. */
const seenUpTo = ref<SeenUpTo>()
// History, not the timeline list: your own unsent messages sort after new arrivals, and deleted
// messages leave the list, so either would lose the anchor.
const historyItems = computed(() => history.data.value?.items ?? [])
const unseen = computed(() =>
  atBottom.value
    ? 0
    : unseenSince(
        historyItems.value,
        seenUpTo.value,
        (m) =>
          !m.deleted &&
          (m.kind === 'message' || m.kind === 'action' || m.kind === 'notice') &&
          !notifications.ignored(chat.member(m.senderId)?.nick),
      ),
)
watch(atBottom, (following) => {
  const last = historyItems.value.at(-1)
  seenUpTo.value = following || !last ? undefined : { id: last.id, createdAt: last.createdAt }
})

// ---- Rows: messages, single events, and runs of join/part/quit/nick collapsed together -------

const headerRows = {
  start: { kind: 'start', key: 'start' },
  loading: { kind: 'loading', key: 'loading' },
  offline: { kind: 'offline', key: 'offline' },
  retry: { kind: 'retry', key: 'retry' },
} as const
type Row = TimelineMessageRow | (typeof headerRows)[keyof typeof headerRows]
const buildRows = createTimelineRows()
const messageRows = computed(() => {
  const hideEvents = preferences.preferences.events === 'hide'
  const { modes } = parsePrefix(chat.network?.isupport)
  if (!notifications.settings.ignore.length)
    return buildRows(messages.value, hideEvents, undefined, modes)
  const ignoredSenders = new Map<string, boolean>()
  return buildRows(
    messages.value,
    hideEvents,
    (message) => {
      const id = message.senderId
      const known = ignoredSenders.get(id)
      if (known !== undefined) return known
      const ignored = notifications.ignored(chat.member(id)?.nick)
      ignoredSenders.set(id, ignored)
      return ignored
    },
    modes,
  )
})
const cachedHistoryBatch = HISTORY_PAGE * 2
const revealedFrom = shallowRef<{ conversation: string; key: string | null }>()
const firstShown = computed(() => {
  const revealed = revealedFrom.value
  const all = messageRows.value
  if (revealed?.conversation === chat.activeId)
    return revealed.key === null ? 0 : Math.max(0, all.findIndex((row) => row.key === revealed.key))
  return Math.max(0, all.length - cachedHistoryBatch)
})
function revealFrom(index: number) {
  const row = messageRows.value[index]
  revealedFrom.value = { conversation: chat.activeId, key: index > 0 && row ? row.key : null }
}
// Switching to a cached channel paints the latest batch first. Once the reader scrolls away,
// hold the first shown row so incoming messages cannot move the edge they are reading toward.
watch(
  atBottom,
  (following) => {
    if (!following) revealFrom(firstShown.value)
    else if (!detached.value) revealedFrom.value = undefined
  },
  { flush: 'sync' },
)
const header = computed(() => {
  if (chat.loadingOlder) return headerRows.loading
  if (history.data.value?.syncError) return headerRows.retry
  if (!firstShown.value && !history.data.value?.nextCursor && !history.data.value?.partial)
    return history.data.value?.offline ? headerRows.offline : headerRows.start
  return undefined
})
const rows = computed<Row[]>(() => {
  const start = firstShown.value
  const shown = start ? messageRows.value.slice(start) : messageRows.value
  return header.value ? [header.value, ...shown] : shown
})
const timeline = useTimelineScroll({
  viewport: scroller,
  content,
  spacer,
  rows: () => rows.value,
  detached: () => detached.value,
  atBottom,
})
const firstOf = (row: Row | undefined) =>
  row?.kind === 'message' || row?.kind === 'events' ? firstMessageOf(row) : undefined

// “New messages” line: placed once per visit, before the first message that was unread.
const markerId = ref('')
watch(
  () => [chat.activeId, history.data.value !== undefined] as const,
  ([id, loaded]) => {
    if (!loaded) return
    // A manual “mark as unread” names its message; otherwise count back from the end.
    const anchor = chat.unreadAnchors[id]
    if (anchor && messages.value.some((m) => m.id === anchor)) return (markerId.value = anchor)
    const count = chat.unreadMarkers[id] ?? 0
    const others = messages.value.filter((m) => m.senderId !== 'you' && m.kind !== 'event')
    markerId.value = count ? (others[Math.max(0, others.length - count)]?.id ?? '') : ''
  },
  { immediate: true },
)
watch(
  () => chat.unreadMarkers[chat.activeId],
  (count) => {
    if (!count && !chat.unreadAnchors[chat.activeId]) markerId.value = ''
  },
)
watch(
  () => chat.unreadAnchors[chat.activeId],
  (anchor) => {
    if (anchor) markerId.value = anchor
    else if (!chat.unreadMarkers[chat.activeId]) markerId.value = ''
  },
)
const markerBefore = (row: Row | undefined) => {
  return !!markerId.value && firstOf(row)?.id === markerId.value
}
const grouped = (row: Row | undefined) => row?.kind === 'message' && row.grouped && !markerBefore(row)
const firstMessageIndex = computed(() => (header.value ? 1 : 0))

/** A row's place in the timeline, for the /attract cues. */
function rowBox(index: number) {
  const visibleIndex = index - firstShown.value + firstMessageIndex.value
  if (visibleIndex < firstMessageIndex.value) return
  const el = scroller.value?.querySelector<HTMLElement>(
    `.timeline-row[data-index="${visibleIndex}"]`,
  )
  return el ? { start: el.offsetTop, size: el.offsetHeight } : undefined
}
/** Embed boxes already know their size. Keep them in normal flow, including off-screen;
 * their expensive contents are mounted only nearby, independently of the reserved space. */
const hasEmbeds = (row: Row) =>
  row.kind === 'message' &&
  (!!row.message.attachment ||
    !!row.message.attachments?.length ||
    /https?:\/\//.test(row.message.text))

// ---- /attract: a short sparkle on someone's message. It never moves your scroll position. ----

const scrollTick = ref(0)
const attract = computed(() => {
  const target = chat.attention[chat.activeId]
  if (!target) return undefined
  const found = resolveAttract(
    messageRows.value.map((r) =>
      r.kind === 'message' ? { id: r.message.id, senderId: r.message.senderId } : undefined,
    ),
    target,
    (index) => grouped(messageRows.value[index]),
  )
  return found && { ...found, startedAt: target.startedAt }
})
function attractOf(index: number) {
  const a = attract.value
  if (!a || index < firstMessageIndex.value || a.row < firstShown.value) return undefined
  const originalIndex = index - firstMessageIndex.value + firstShown.value
  const avatar = Math.max(a.avatar, firstShown.value)
  if (originalIndex === a.row) return a.row === avatar ? 'both' : 'row'
  if (originalIndex === avatar) return 'avatar'
}
/**
 * Where the message is when it is out of view: below, the “Jump to present” pill carries the cue;
 * above, a glow along the timeline's top edge does.
 */
const attractOffscreen = computed<'above' | 'below' | undefined>(() => {
  const a = attract.value
  const el = scroller.value
  if (!a || !el) return undefined
  void scrollTick.value
  return offscreen(a.row, rowBox(a.row), firstShown.value, el)
})
const pillCue = computed(
  () => attractOffscreen.value === 'below' && (!atBottom.value || detached.value),
)
const edgeCue = computed(() => attractOffscreen.value === 'above')
/** Each cue's clock is set when it appears, never on later re-renders (see `attractClock`). */
const pillClock = ref<Record<string, string>>()
const edgeClock = ref<Record<string, string>>()
watch(
  () => [pillCue.value, attract.value?.startedAt] as const,
  ([on, startedAt]) => (pillClock.value = on && startedAt ? attractClock(startedAt) : undefined),
)
watch(
  () => [edgeCue.value, attract.value?.startedAt] as const,
  ([on, startedAt]) => (edgeClock.value = on && startedAt ? attractClock(startedAt) : undefined),
)

function scrollLatest() {
  nextTick(() => timeline.scrollToEnd())
}
let previousTop = 0
let pageDirection: 'older' | 'newer' = 'older'
let historyFrame: number | undefined
const newerFailed = ref(false)
// Read only from event callbacks: this flag needs no cached reactive subscription.
const paging = () => chat.loadingOlder || chat.loadingNewer
function onScroll() {
  if (attract.value) scrollTick.value++
  const top = timeline.onScroll()
  if (top !== previousTop) pageDirection = top < previousTop ? 'older' : 'newer'
  previousTop = top
  checkHistoryBeforePaint()
}
// Wheel and scroll events can arrive together. Read the timeline's bounds once per frame.
function checkHistoryBeforePaint() {
  if (historyFrame !== undefined) return
  historyFrame = requestAnimationFrame(() => {
    historyFrame = undefined
    pageNearEdge()
  })
}
onBeforeUnmount(() => {
  if (historyFrame !== undefined) cancelAnimationFrame(historyFrame)
})
/** Both edges advance within retained history; the present button is only a shortcut. */
function pageNearEdge() {
  const el = scroller.value
  if (!el || paging()) return
  const page = history.data.value
  const canPageOlder = firstShown.value > 0 || (page?.nextCursor && !page.syncError)
  const canPageNewer = page?.hasNewer && !newerFailed.value
  if (!canPageOlder && !canPageNewer) return
  const height = el.clientHeight
  const distance = Math.max(900, height * 1.5)
  const top = el.scrollTop
  const nearTop = top < distance
  if (!nearTop && !canPageNewer) return
  const nearBottom = el.scrollHeight - top - height < distance
  if (canPageNewer && nearBottom && (!nearTop || pageDirection === 'newer')) void newer()
  else if (canPageOlder && nearTop && (!nearBottom || pageDirection === 'older')) void older()
}
async function older() {
  if (firstShown.value > 0) {
    revealFrom(Math.max(0, firstShown.value - cachedHistoryBatch))
    return
  }
  const id = chat.activeId
  const loaded = await chat.loadOlder(id)
  if (loaded && id === chat.activeId) {
    fillUp()
    checkHistoryBeforePaint()
  }
}
async function newer() {
  const id = chat.activeId
  newerFailed.value = false
  const loaded = await chat.loadNewer(id)
  if (id !== chat.activeId) return
  if (loaded === false) newerFailed.value = true
  else if (loaded) {
    fillUp()
    checkHistoryBeforePaint()
  }
}
/**
 * Older history loads as the reader nears the top, which takes a scroll event. When the loaded
 * messages don't fill the timeline there is nothing to scroll, so keep loading until they do.
 */
function fillUp() {
  const id = chat.activeId
  nextTick(() => {
    const el = scroller.value
    if (!el || id !== chat.activeId || paging() || el.scrollHeight - el.clientHeight >= 300) return
    if (pageDirection === 'newer' && history.data.value?.hasNewer && !newerFailed.value)
      void newer()
    else if (
      pageDirection === 'older' &&
      (firstShown.value > 0 || (history.data.value?.nextCursor && !history.data.value?.syncError))
    )
      void older()
  })
}
/** Wheel and swipe intent still pages at an edge when there is nothing left to scroll. */
function scrollIntent(direction: 'up' | 'down') {
  stopResume()
  timeline.userScrollIntent(direction)
  pageDirection = direction === 'up' ? 'older' : 'newer'
  checkHistoryBeforePaint()
}
function scrollWheel(event: WheelEvent) {
  if (event.deltaY && !event.ctrlKey) scrollIntent(event.deltaY < 0 ? 'up' : 'down')
}
function scrollKey(event: KeyboardEvent) {
  // Keys from a link or button in a row scroll the timeline too; typing in a field doesn't.
  if (event.defaultPrevented || isEditable(event.target)) return
  if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) scrollIntent('down')
  else if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) scrollIntent('up')
  else if (
    event.key === ' ' &&
    !(event.target instanceof Element && event.target.closest('button, [role="button"]'))
  )
    scrollIntent(event.shiftKey ? 'up' : 'down')
}
function pointerDown(event: PointerEvent) {
  stopResume()
  // A context click may open a native menu without delivering its release.
  if (event.pointerType !== 'touch' && event.button === 0) timeline.hold()
}
let touchY = 0
let touchOrigin = { x: 0, y: 0 }
let verticalPan: boolean | undefined
function touchStart(event: TouchEvent) {
  stopResume()
  const touch = event.touches[0]
  if (!touch) return
  timeline.hold()
  touchY = touch.clientY
  touchOrigin = { x: touch.clientX, y: touchY }
  verticalPan = undefined
}
function touchMove(event: TouchEvent) {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]!
  const dx = Math.abs(touch.clientX - touchOrigin.x)
  const dy = Math.abs(touch.clientY - touchOrigin.y)
  // A sideways swipe for reply or drawers must leave the live follow choice alone.
  if (verticalPan === undefined && Math.hypot(dx, dy) > 10) verticalPan = dx < dy * 1.2
  if (verticalPan && touch.clientY !== touchY) scrollIntent(touch.clientY > touchY ? 'up' : 'down')
  touchY = touch.clientY
}
watch(() => [chat.activeId, history.data.value] as const, fillUp, { flush: 'post' })
watch(
  () => chat.activeId,
  () => {
    previousTop = 0
    revealedFrom.value = undefined
    pageDirection = 'older'
    newerFailed.value = false
  },
)
watch(
  () => historyItems.value.at(-1)?.id,
  () => {
    newerFailed.value = false
  },
)
/** Messages already in the list. Only unknown ones after a known one are news. */
let known = new Set(messages.value.map((m) => m.id))
let wasDetached = detached.value

/**
 * Leaving the app (switching apps on a phone, another tab) and coming back: a reader who was
 * following the conversation lands on the newest message, including history that arrives as the
 * connection catches up. A reader who had scrolled up to read history stays where they were.
 */
let followingWhenHidden = false
let resumeUntil = 0
const RESUME_CATCH_UP = 4000
function onVisibility() {
  if (document.visibilityState === 'hidden') {
    followingWhenHidden = atBottom.value && !detached.value
    resumeUntil = 0
    return
  }
  if (!followingWhenHidden) return
  followingWhenHidden = false
  resumeUntil = Date.now() + RESUME_CATCH_UP
  // A thumb already on the screen as the app comes back wins; arrivals catch up after it lifts.
  if (!timeline.userInteracting()) scrollLatest()
}
/** The reader's own scrolling ends the catch-up. */
const stopResume = () => (resumeUntil = 0)
useEventListener(document, 'visibilitychange', onVisibility)
useEventListener(window, 'pageshow', (event: PageTransitionEvent) => {
  if (event.persisted) onVisibility()
})
// Sending a message brings you to the latest, once per message; otherwise the engine follows
// while you're there. Other arrivals while it is still pending must not pull you back. This runs
// before the row renders, so the engine glides it in rather than snapping to it first.
watch(
  () => {
    const latest = messages.value.at(-1)
    return latest?.delivery === 'pending' ? (latest.clientId ?? latest.id) : undefined
  },
  (sending) => {
    // Sent while holding or dragging the timeline: the reader's hand wins, the pill shows the way.
    if (!sending || timeline.userInteracting()) return
    // A window into older history first goes back to the present.
    if (detached.value) return void jumpToPresent()
    atBottom.value = true
    timeline.scrollToEnd(!appearance.reducedMotion)
  },
  { flush: 'pre' },
)
watch(
  messages,
  () => {
    // Back from another app while following: land on the newest message once the history caught up.
    // Only while still following: a reader who scrolled away by any means, even a scrollbar drag
    // no event reports, has left the catch-up.
    if (resumeUntil > Date.now() && atBottom.value && !timeline.userInteracting())
      scrollLatest()
    // Nothing is known while history first loads or after switching, and older history arrives
    // above the first known message: neither is news.
    const list = messages.value
    const first = list.findIndex((m) => known.has(m.id))
    const added = first < 0 ? [] : list.slice(first).filter((m) => !known.has(m.id))
    known = new Set(list.map((m) => m.id))
    if (added.length && atBottom.value && !wasDetached && !detached.value) announce(added)
    wasDetached = detached.value
  },
  { flush: 'post' },
)

// Screen readers hear one live region, at most every few seconds. At the latest message a busy
// channel becomes “4 new messages, latest from jules: …”; scrolled up, only the count is read.
// The log itself stays silent, so rows are never read twice and loaded history is never read.
const announcement = ref('')
let announced = 0
let pendingCount = 0
let compose: (() => string) | undefined
let announceTimer: ReturnType<typeof setTimeout> | undefined
const newMessages = (count: number) => t('timeline.newMessages', { count: n(count) }, count)
const heard = (m: Message) =>
  m.senderId !== 'you' &&
  m.kind !== 'event' &&
  !notifications.ignored(chat.member(m.senderId)?.nick)
function flushAnnouncement() {
  const text = compose?.()
  compose = undefined
  if (!text) return
  announcement.value = text
  announced = Date.now()
}
function schedule(next: () => string) {
  compose = next
  clearTimeout(announceTimer)
  const wait = announced + 4000 - Date.now()
  if (wait <= 0) flushAnnouncement()
  else announceTimer = setTimeout(flushAnnouncement, wait)
}
function announce(added: Message[]) {
  const incoming = added.filter((m) => heard(m) && !m.delivery)
  if (!incoming.length) return
  pendingCount += incoming.length
  schedule(() => {
    const last = messages.value.findLast(heard)
    const count = pendingCount
    pendingCount = 0
    if (!last || !count) return ''
    const who = chat.member(last.senderId)?.nick ?? t('timeline.someone')
    const text = stripFormatting(last.text).slice(0, 140)
    return count === 1
      ? t('timeline.latestSingle', { who, text })
      : t('timeline.latestMultiple', { count: newMessages(count), who, text })
  })
}
watch(unseen, (count, previous) => {
  if (count <= previous) return
  pendingCount = 0
  schedule(() => (unseen.value && !atBottom.value ? newMessages(unseen.value) : ''))
})
watch(
  () => chat.activeId,
  () => {
    clearTimeout(announceTimer)
    pendingCount = 0
    compose = undefined
    announcement.value = ''
    known = new Set(messages.value.map((m) => m.id))
  },
)
onBeforeUnmount(() => clearTimeout(announceTimer))
// A highlighted message is jumped to once, as soon as its row exists; later arrivals must not
// pull the reader back to it after they have scrolled on.
let highlighted: string | undefined
watch(
  () => [props.highlightId, messages.value.length] as const,
  async ([id]) => {
    if (id !== highlighted) highlighted = undefined
    if (!id || highlighted) return
    await nextTick()
    const index = messageRows.value.findIndex((r) => r.kind === 'message' && r.message.id === id)
    if (index >= 0 && props.highlightId === id) {
      highlighted = id
      await jumpToRow(index)
    }
  },
)
watch(
  () => chat.activeId,
  () => (highlighted = undefined),
)

// Keyboard shortcuts for the “New messages” line and the newest message.
const actions = useWorkspaceActions()
async function jumpToRow(index: number) {
  const row = messageRows.value[index]
  if (!row) return
  const id = chat.activeId
  if (index < firstShown.value) {
    revealFrom(Math.max(0, index - cachedHistoryBatch))
    await nextTick()
  }
  if (chat.activeId === id) timeline.jumpToMessage(row.key)
}

function jumpToUnread() {
  const index = markerId.value
    ? messageRows.value.findIndex((row) => firstMessageOf(row)?.id === markerId.value)
    : -1
  if (index < 0) {
    chat.notify(t('workspaceUi.history.nothingUnreadHere'))
    return true
  }
  void jumpToRow(index)
  return true
}
function jumpToPresentKey() {
  void jumpToPresent()
  return true
}
actions.jumpToUnread = jumpToUnread
actions.jumpToPresent = jumpToPresentKey
onBeforeUnmount(() => {
  if (actions.jumpToUnread === jumpToUnread) actions.jumpToUnread = () => false
  if (actions.jumpToPresent === jumpToPresentKey) actions.jumpToPresent = () => false
})

// Copying a stretch of the timeline gives a plain log, one line per message or event, instead of
// the avatars, reaction buttons and layout gaps the browser would pick up from the rows. A
// selection inside one message or event (a word, a timestamp, a date divider) copies natively.
const controls = '.message-actions, .mobile-message-menu, .avatar-button, .reactions'
const structure = '.message-row, .message-grid, .message-body, .irc-line, .event-row'
/** The part of `range` inside `el`, or null when they only touch at a boundary. */
function overlap(range: Range, el: Element) {
  if (!range.intersectsNode(el)) return null
  const part = document.createRange()
  part.selectNodeContents(el)
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
    part.setStart(range.startContainer, range.startOffset)
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
    part.setEnd(range.endContainer, range.endOffset)
  const content = part.cloneContents()
  return part.toString().trim() || content.querySelector('svg, img') ? part : null
}
function onCopy(event: ClipboardEvent) {
  const selection = document.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed || !scroller.value || !event.clipboardData)
    return
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  const range = selection.getRangeAt(0)
  // Each selected message, each selected line of an expanded activity list, or a whole
  // collapsed activity run, in timeline order.
  const units: { el?: Element; index: number; messages: Message[] }[] = []
  for (const el of scroller.value.querySelectorAll<HTMLElement>('.timeline-row')) {
    const index = Number(el.dataset.index)
    const row = rows.value[index]
    if (row?.kind === 'message') {
      const item = el.querySelector('.message-row')
      if (item && overlap(range, item)) units.push({ el: item, index, messages: [row.message] })
    } else if (row?.kind === 'events') {
      const lines = [...el.querySelectorAll('.event-list li[data-event-id]')].filter((li) =>
        overlap(range, li),
      )
      for (const li of lines) {
        const event = row.events.find((m) => m.id === li.getAttribute('data-event-id'))
        if (event) units.push({ el: li, index, messages: [event] })
      }
      const item = el.querySelector('.event-row')
      if (!lines.length && item && overlap(range, item))
        units.push({ el: item, index, messages: row.events })
    }
  }
  units.sort((a, b) => a.index - b.index)
  if (!units.length) return
  const common = range.commonAncestorContainer
  const within = common instanceof Element ? common : common.parentElement
  const touchesControl = [...scroller.value.querySelectorAll(controls)].some((el) =>
    overlap(range, el),
  )
  if (
    units.length === 1 &&
    !touchesControl &&
    within &&
    units[0]!.el?.contains(within) &&
    !within.matches(structure)
  )
    return
  const nick = (id: string) => chat.member(id)?.nick ?? id
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  const picked = units.flatMap((unit) => unit.messages)
  event.clipboardData.setData(
    'text/plain',
    selectionLog(
      picked,
      nick,
      time,
      date,
      (key, values, plural) =>
        values ? (plural === undefined ? t(key, values) : t(key, values, plural)) : t(key),
      locale.value,
    ),
  )
  event.preventDefault()
}
onMounted(() => document.addEventListener('copy', onCopy))
onBeforeUnmount(() => document.removeEventListener('copy', onCopy))
</script>
<template>
  <div class="timeline-wrap relative flex-1 min-h-0">
    <div
      v-if="edgeCue"
      class="attract-edge absolute top-0 left-0 right-0 h-7 z-3 pointer-events-none [background:linear-gradient(_to_bottom,_color-mix(in_srgb,_var(--accent)_45%,_transparent),_transparent_)] [animation:attract-edge_calc(var(--attract-ms,_3000ms)_/_3)_ease-out_var(--attract-delay,_0ms)_3]"
      :style="edgeClock"
      aria-hidden="true"
    />
    <div
      ref="viewport"
      class="timeline-scroll h-full overflow-y-auto [overflow-anchor:auto] overscroll-contain outline-offset-[-2px]! [touch-action:pan-y_pinch-zoom]"
      tabindex="0"
      :aria-label="t('timeline.history')"
      @scroll.passive="onScroll"
      @touchstart.passive="touchStart"
      @pointerdown.passive="pointerDown"
      @wheel.passive="scrollWheel"
      @touchmove.passive="touchMove"
      @keydown="scrollKey"
    >
      <div
        v-if="!chat.active"
        class="empty-state h-full min-h-70 flex flex-col items-center justify-center p-6 gap-3 text-muted-foreground text-center"
      >
        <AppIcon
          name="message"
          :size="30"
        />
        <h2 class="text-foreground text-[17px]">
          {{
            chat.data?.networks.length
              ? t('timeline.chooseConversation')
              : t('timeline.firstNetwork')
          }}
        </h2>
        <p>
          {{
            chat.data?.networks.length
              ? t('timeline.chooseConversationHelp')
              : t('timeline.firstNetworkHelp')
          }}
        </p>
        <div
          v-if="!chat.data?.networks.length"
          class="flex flex-wrap items-center justify-center gap-2"
        >
          <UiButton @click="actions.addNetwork()">
            {{ t('networks.add') }}
          </UiButton>
          <UiButton
            variant="secondary"
            @click="actions.settings('profile')"
          >
            {{ t('timeline.editProfile') }}
          </UiButton>
        </div>
      </div>
      <div
        v-else-if="history.isLoading.value && !messages.length"
        class="timeline-skeleton py-6 px-4"
        aria-busy="true"
      >
        <span
          class="sr-only"
          role="status"
          >{{ t('timeline.loading') }}</span
        >
        <div
          v-for="i in 6"
          :key="i"
          class="skeleton-message grid [grid-template-columns:40px_1fr] gap-[8px_14px] mb-6 [&>span]:h-3 [&>span]:w-3/5 [&>span]:bg-secondary [&>span]:rounded-[6px] [&>span]:animate-[pulse_1.6s_ease-in-out_infinite] [&>span:first-of-type]:w-30 odd:[&>span:last-child]:w-[85%]"
        >
          <i class="row-span-2 size-10 rounded-full bg-secondary" /><span /><span />
        </div>
      </div>
      <div
        v-else-if="history.error.value && !messages.length"
        class="empty-state h-full min-h-70 flex flex-col items-center justify-center p-6 gap-3 text-muted-foreground text-center"
      >
        <AppIcon
          name="offline"
          :size="28"
        />
        <h2 class="text-foreground text-[17px]">{{ t('timeline.loadFailed') }}</h2>
        <p>{{ errorText(history.error.value, t) }}</p>
        <UiButton @click="history.refetch()"> {{ t('common.tryAgain') }} </UiButton>
      </div>
      <!-- The bottom padding is room for the composer's typing line, so it never covers a message. -->
      <div
        v-else
        :key="chat.activeId"
        ref="content"
        class="timeline-rows flow-root min-h-full pt-2 pr-0 pb-6 pl-0"
        role="log"
        aria-live="off"
      >
        <div
          v-for="(row, index) in rows"
          :key="row.key"
          :data-message-id="row.key"
          :data-index="index"
          class="timeline-row flow-root"
          :class="{
            '[content-visibility:auto] [contain-intrinsic-size:auto_56px]':
              skipOffscreenRows && !hasEmbeds(row),
          }"
        >
          <div
            v-if="row.kind === 'start'"
            class="conversation-start pt-8 pr-4 pb-2 pl-4"
          >
            <UserAvatar
              v-if="chat.active?.kind === 'direct' && !chat.active.party && startPartner"
              :member="startPartner"
              size="large"
              presence
              class="mb-3"
            />
            <span
              v-else
              class="welcome-symbol inline-flex items-center justify-center w-14 h-14 rounded-full [background:linear-gradient(135deg,color-mix(in_srgb,var(--accent)_24%,var(--raised)),color-mix(in_srgb,var(--accent)_6%,var(--raised)))] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)] mb-3"
              ><AppIcon
                :name="
                  chat.active?.party ? 'users' : chat.active?.kind === 'direct' ? 'message' : 'hash'
                "
                :size="24"
            /></span>
            <h2 class="text-[26px] font-bold tracking-[-0.02em] mb-1">
              {{
                chat.active?.party
                  ? conversationName(chat.active)
                  : chat.active?.kind === 'direct'
                    ? (chat.directPartner(chat.active)?.displayName ?? chat.active.name)
                    : `#${chat.active?.name}`
              }}
            </h2>
            <p class="text-[14px] text-muted-foreground max-w-[72ch]">
              {{
                chat.active?.party
                  ? t('workspaceUi.party.beginning')
                  : chat.active?.kind === 'direct'
                    ? t('timeline.directBeginning')
                    : t('timeline.channelBeginning', { channel: `#${chat.active?.name}` })
              }}
              <template v-if="startPartner?.bio"
                ><br /><MessageRuns :text="startPartner.bio"
              /></template>
              <template
                v-if="chat.active?.topic && chat.active.kind === 'channel' && !chat.active.party"
              >
                <br /><MessageContent :text="chat.active.topic"
              /></template>
            </p>
          </div>
          <div
            v-else-if="row.kind === 'retry'"
            class="history-load flex items-center justify-center gap-3 p-4 text-muted-foreground text-[12px]"
            role="status"
          >
            <span>{{ t('timeline.olderLoadFailed') }}</span>
            <UiButton
              size="sm"
              variant="secondary"
              @click="older"
            >
              {{ t('common.tryAgain') }}
            </UiButton>
          </div>
          <div
            v-else-if="row.kind === 'offline'"
            class="history-load p-4 text-center text-muted-foreground text-[12px]"
            role="status"
          >
            {{ t('timeline.savedHistoryEnd') }}
          </div>
          <div
            v-else-if="row.kind === 'loading'"
            class="history-load p-4 text-center text-faint text-[12px]"
          >
            {{ t('timeline.loadingEarlier') }}
          </div>
          <template v-else>
            <div
              v-if="row.dayBreak || index === firstMessageIndex"
              class="date-divider flex items-center gap-2.5 mt-4 mr-4 mb-1 ml-4 text-faint text-[11px] font-[600] whitespace-nowrap before:content-[''] before:h-px before:bg-border before:flex-1 after:content-[''] after:h-px after:bg-border after:flex-1 [&>span]:rounded-full [&>span]:bg-secondary/55 [&>span]:px-2.5 [&>span]:py-0.5 [&>span]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_55%,transparent)]"
              role="separator"
              :aria-label="day(firstOf(row)!.createdAt)"
            >
              <span>{{ day(firstOf(row)!.createdAt) }}</span>
            </div>
            <div
              v-if="markerBefore(row)"
              class="unread-divider flex items-center mt-2 mr-4 mb-1 ml-4 h-[1px] bg-destructive"
              role="separator"
              :aria-label="t('timeline.newMessagesLabel')"
            >
              <span
                class="ml-auto px-1.5 rounded-[4px] bg-destructive text-rail text-[10px] font-bold leading-4 uppercase"
                >{{ t('timeline.new') }}</span
              >
            </div>
            <MessageItem
              v-if="row.kind === 'message'"
              :message="row.message"
              :menus="menus"
              :message-actions="messageActions"
              :touch-menu="touchMenu"
              :reaction-id="reactionId"
              :grouped="index !== firstMessageIndex && grouped(row)"
              :highlighted="row.message.id === highlightId"
              :attract="attractOf(index)"
              :attract-started-at="attract?.startedAt"
              @reply="emit('reply', $event)"
              @profile="emit('profile', $event)"
              @reaction="reactionId = $event"
            />
            <EventRow
              v-else-if="row.kind === 'events'"
              :events="row.events"
              @profile="emit('profile', $event)"
            />
          </template>
        </div>
        <div
          v-if="chat.loadingNewer || newerFailed"
          class="history-load flex items-center justify-center p-4 text-muted-foreground text-[12px]"
          role="status"
        >
          <UiButton
            v-if="newerFailed"
            size="sm"
            variant="secondary"
            @click="newer"
          >
            {{ t('common.tryAgain') }}
          </UiButton>
          <span v-else>{{ t('timeline.loading') }}</span>
        </div>
        <div
          ref="spacer"
          aria-hidden="true"
          hidden
        />
      </div>
    </div>
    <button
      v-if="(!atBottom || detached) && messages.length"
      class="jump-latest absolute bottom-3 left-1/2 z-10 [transform:translateX(-50%)] flex items-center gap-2 bg-primary text-primary-foreground py-1.5 px-3 rounded-[999px] text-[12px] font-[600] shadow-control whitespace-nowrap"
      :class="{ 'is-attract': pillCue }"
      :style="pillClock"
      @click="jumpToPresent"
    >
      {{
        unseen && !detached
          ? newMessages(unseen)
          : detached
            ? t('timeline.viewingOlder')
            : t('timeline.jumpToPresent')
      }}<AppIcon
        name="down"
        :size="14"
      />
    </button>
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      >{{ announcement }}</span
    >
  </div>
</template>
