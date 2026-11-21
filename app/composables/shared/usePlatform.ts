import { createPlatform } from '../../utils/platform'

let platform: ReturnType<typeof createPlatform> | undefined

/** Select the device APIs once for the lifetime of this app window. */
export function usePlatform() {
  return platform ??= createPlatform(window)
}
