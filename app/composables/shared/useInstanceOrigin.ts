/** The address to share with other IRCord users. */
export function useInstanceOrigin() {
  const { instanceUrl } = useRuntimeConfig().public
  return () => instanceUrl || window.location.origin
}
