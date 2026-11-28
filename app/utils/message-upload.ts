import { shallowRef, watch, type Ref } from 'vue'

/** What a file attached to a message may be: the types and size its host accepts. */
export interface UploadLimits {
  maxBytes: number
  types: string[]
}

/** The answer of `GET /api/v1/networks/{id}/uploads`, as far as the limits need it. */
export interface UploadProvider {
  available: boolean
  maxBytes: number
  types?: string[] | null
}

/** The limits a provider answer allows, or nothing when its host takes no files now. */
export const uploadLimits = (provider: UploadProvider): UploadLimits | undefined =>
  provider.available ? { maxBytes: provider.maxBytes, types: provider.types ?? [] } : undefined

/**
 * Where files attached to a message go on the open network, asked of the server for each network
 * that opens. The first lookup runs at once: a saved workspace can open its network before this
 * starts, and a watch that only saw later changes would never ask for that network.
 *
 * `refresh` asks again for the open network. A lookup that failed or found the host unavailable
 * is not repeated on its own, so the composer asks again when someone attaches a file.
 */
export function createMessageUpload(
  networkId: Ref<string>,
  lookup: (networkId: string) => Promise<UploadProvider>,
  enabled: () => boolean = () => true,
) {
  const limits = shallowRef<UploadLimits>()
  async function discover(id: string) {
    if (!id || !enabled()) return
    try {
      const provider = await lookup(id)
      // A slow answer for a network that is no longer open must not describe the new one.
      if (networkId.value === id) limits.value = uploadLimits(provider)
    } catch {
      /* Message uploads stay unavailable until a lookup succeeds. */
    }
  }
  watch(
    networkId,
    (id) => {
      limits.value = undefined
      void discover(id)
    },
    { immediate: true },
  )
  return { limits, refresh: () => discover(networkId.value) }
}
