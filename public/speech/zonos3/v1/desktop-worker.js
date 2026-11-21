// Keep the model manifests and cache keys on the app origin. Only uncached
// weight downloads use the redirects already resolved by the desktop client.
let redirects = {}
self.addEventListener('message', ({ data }) => {
  if (data?.type === 'init') redirects = data.shardRedirects ?? {}
})
const read = self.fetch.bind(self)
self.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, self.location.href)
  const location = redirects[url.href]
  if (!location) return read(input, options)
  return read(location, {
    ...(input instanceof Request && { headers: input.headers, signal: input.signal }),
    ...options,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
}

await import('./worker.js')
