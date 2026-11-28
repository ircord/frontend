import { useQuery } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import type { SearchResult } from '../../../shared/types/chat'
import { canSearch, type SearchFilters } from '../../../shared/utils/search-filter'
import { messageSearchQuery } from '../../queries/chat'
import { readSearch, offlineStatus } from '../../utils/offline-archive'
import { useCursorPages } from '../shared/useCursorPages'
import { effectiveSearchSource, searchCacheKey, type SearchSourceMode } from './search-source'

/** Shared account-scoped search and paging for both message search surfaces. */
export function useMessageSearch(
  text: MaybeRefOrGetter<string>,
  filters: MaybeRefOrGetter<SearchFilters>,
  source: MaybeRefOrGetter<SearchSourceMode> = 'retained',
) {
  const effectiveSource = computed(() =>
    effectiveSearchSource(toValue(source), toValue(filters).in.length, offlineStatus.value.offline),
  )
  const key = computed(() =>
    JSON.stringify(
      searchCacheKey(
        toValue(text),
        toValue(filters),
        offlineStatus.value.offline,
        effectiveSource.value,
      ),
    ),
  )
  const enabled = computed(() => canSearch(toValue(text), toValue(filters)))
  const search = useQuery(() => ({
    ...messageSearchQuery({
      text: toValue(text),
      filters: toValue(filters),
      source: effectiveSource.value,
    }),
    enabled: enabled.value,
  }))
  const {
    items: results,
    cursor,
    loadMore,
    loadingMore,
    moreError,
  } = useCursorPages<SearchResult>({
    firstPage: search.data,
    resetOn: [key, search.data],
    itemKey: (result) => result.message.id,
    load: (cursor, signal) =>
      readSearch(toValue(text), toValue(filters), cursor, signal, effectiveSource.value),
    enabled,
    duplicates: 'keep-last',
  })
  const local = useEncryptedSearch(text, filters)
  // Encrypted chats are searched on this device; the server cannot read them. Local hits come
  // first, newest first, then the server's results.
  const merged = computed(() => {
    if (!local.value.length) return results.value
    const ids = new Set(local.value.map((r) => r.message.id))
    return [...local.value, ...results.value.filter((r) => !ids.has(r.message.id))]
  })
  return {
    search,
    results: merged,
    cursor,
    loadMore,
    loadingMore,
    moreError,
    source: effectiveSource,
    encryptedHits: computed(() => local.value.length),
  }
}

/** Search results from this device's decrypted messages, for text and `in:` only. */
function useEncryptedSearch(
  text: MaybeRefOrGetter<string>,
  filters: MaybeRefOrGetter<SearchFilters>,
) {
  const e2ee = useE2eeStore()
  const chat = useChatStore()
  const hits = shallowRef<SearchResult[]>([])
  watch(
    () => [toValue(text), toValue(filters).in.join(','), e2ee.ready] as const,
    async ([query, scope, ready], _previous, onCleanup) => {
      let stale = false
      onCleanup(() => (stale = true))
      if (!ready || !query.trim()) return void (hits.value = [])
      const within = scope ? scope.split(',') : []
      const records = (
        await e2ee.search(query, within.length === 1 ? within[0] : undefined)
      ).filter((r) => !within.length || within.includes(r.conversationId))
      if (stale) return
      hits.value = records.flatMap((record) => {
        const conversation = chat.data?.conversations.find((c) => c.id === record.conversationId)
        if (!conversation || !record.messageId || record.payload?.t !== 'msg') return []
        const mine = record.own || record.account.toLowerCase() === e2ee.account.toLowerCase()
        return [
          {
            conversation,
            message: {
              id: record.messageId,
              conversationId: record.conversationId,
              senderId: mine ? 'you' : (chat.directPartner(conversation)?.id ?? ''),
              text: record.payload.text,
              createdAt: new Date(record.at).toISOString(),
              kind: record.payload.kind === 'action' ? 'action' : 'message',
              reactions: [],
              e2ee: { state: 'ok', innerId: record.payload.id },
            },
          } as SearchResult,
        ]
      })
    },
    { immediate: true },
  )
  return hits
}
