/** The address to share with other IRCord users. */
export function useInstanceOrigin() {
  const instanceUrl = usePlatform().serverOrigin || useRuntimeConfig().public.instanceUrl
  return () => instanceUrl || window.location.origin
}
