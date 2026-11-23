import { appearanceBootScript } from './shared/appearance-boot'
import { compileAppearance, defaultAppearance } from './shared/appearance'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NuxtPage } from 'nuxt/schema'
import { fontFamilies } from './shared/fonts'
import { localSpeechHosts } from './shared/local-speech'
import { parseCollaborators } from './shared/utils/collaborators'
import type { Changelog } from './shared/utils/changelog'

// DevTools also creates watchers outside Nuxt's watcher options. Apply the
// workaround to every Chokidar watcher, while respecting explicit user settings.
if (process.platform === 'darwin' && process.versions.bun) {
  process.env.CHOKIDAR_USEPOLLING ??= 'true'
  process.env.CHOKIDAR_INTERVAL ??= '250'
}
// Read the contributor credits from this repository during the build.
const collaboratorsFile = new URL('./COLLABORATORS.md', import.meta.url)
const collaborators = existsSync(collaboratorsFile)
  ? parseCollaborators(readFileSync(collaboratorsFile, 'utf8'))
  : []
const desktopOutput = process.env.IRCORD_DESKTOP_BUILD_DIR
const desktopBuildDir = process.env.IRCORD_DESKTOP_DEV_DIR

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  future: { compatibilityVersion: 5 },
  vue: { vapor: true },
  ssr: false,
  pages: true,
  devtools: { enabled: false },
  ...(desktopBuildDir && { buildDir: desktopBuildDir }),
  // Feature folders organize ownership without changing public component names.
  // Keep the fallback scan last for the existing embed and scroller names.
  components: [
    ...[
      'account',
      'admin',
      'chat',
      'media',
      'network',
      'search',
      'settings',
      'shared',
      'workspace',
    ].map((feature) => ({ path: `~/components/${feature}`, pathPrefix: false })),
    { path: '~/components/ui', prefix: 'Ui', pathPrefix: false, extensions: ['vue'] },
    { path: '~/components', ignore: ['ui/**'] },
  ],
  imports: { dirs: ['composables/**'] },
  modules: [
    './nuxt-modules/embeds',
    '@pinia/nuxt',
    '@pinia/colada-nuxt',
    '@nuxt/fonts',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
    '@nuxt/eslint',
  ],
  fonts: {
    // Its legacy DevTools adapter imports H3 v2 APIs into our Nitro 2/H3 v1 app.
    devtools: false,
    provider: 'npm',
    npm: { remote: false },
    // fonts.css declares every runtime choice. Keep one face-generation path;
    // global faces would also inject a separate stylesheet for these families.
    processCSSVariables: 'font-prefixed-only',
    families: fontFamilies.map((name) => ({ name, preload: false })),
    defaults: { weights: ['100 900'], styles: ['normal'] },
  },
  vueuse: { autoImports: true },
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: [
      {
        code: 'en',
        language: 'en',
        name: 'English',
        files: [
          'en.json',
          'en/workspace.json',
          'en/collections.json',
          'en/media.json',
          'en/themes.json',
        ],
      },
    ],
    langDir: 'locales',
    vueI18n: './i18n.config.ts',
  },
  eslint: { checker: false, config: { stylistic: false, autoInit: false } },
  css: ['~/assets/css/fonts.css', '~/assets/css/tailwind.css'],
  vite: {
    plugins: [tailwindcss()],
    // Module output keeps code splitting in worker-style bundles: the diagram frame loads one
    // Mermaid chunk per diagram type instead of all of them. Every worker starts as a module.
    worker: { format: 'es' },
    optimizeDeps: {
      // Keep shared dependencies pre-bundled so Vite does not reload on first use.
      include: [
        '@lucide/vue',
        '@tanstack/vue-virtual',
        'ajv/dist/runtime/ucs2length.js',
        'class-variance-authority',
        'clsx',
        'highlight.js/lib/core',
        'highlight.js/lib/languages/bash',
        'highlight.js/lib/languages/c',
        'highlight.js/lib/languages/cpp',
        'highlight.js/lib/languages/csharp',
        'highlight.js/lib/languages/css',
        'highlight.js/lib/languages/diff',
        'highlight.js/lib/languages/dockerfile',
        'highlight.js/lib/languages/go',
        'highlight.js/lib/languages/ini',
        'highlight.js/lib/languages/java',
        'highlight.js/lib/languages/javascript',
        'highlight.js/lib/languages/json',
        'highlight.js/lib/languages/kotlin',
        'highlight.js/lib/languages/lua',
        'highlight.js/lib/languages/makefile',
        'highlight.js/lib/languages/markdown',
        'highlight.js/lib/languages/php',
        'highlight.js/lib/languages/python',
        'highlight.js/lib/languages/ruby',
        'highlight.js/lib/languages/rust',
        'highlight.js/lib/languages/scss',
        'highlight.js/lib/languages/shell',
        'highlight.js/lib/languages/sql',
        'highlight.js/lib/languages/swift',
        'highlight.js/lib/languages/typescript',
        'highlight.js/lib/languages/xml',
        'highlight.js/lib/languages/yaml',
        'mermaid',
        'openapi-fetch',
        'satori',
        'tailwind-merge',
      ],
    },
  },
  nitro: {
    preset: desktopOutput ? 'static' : 'bun',
    experimental: { websocket: !desktopOutput },
    compressPublicAssets: true,
    ...(desktopOutput && {
      output: { dir: desktopOutput },
    }),
  },
  // The production server passes each request's peer address on and sets its own timeouts and
  // body cap (see the file). Development keeps Nitro's dev server.
  $production: desktopOutput ? {} : {
    nitro: { entry: fileURLToPath(new URL('./server/entry.bun.ts', import.meta.url)) },
  },
  // Nuxt polls /_nuxt/builds/latest.json for a newer build (default hourly). useAppUpdate also
  // checks on every WebSocket reconnect; this poll covers tabs whose socket never dropped.
  experimental: {
    asyncEntry: false,
    checkOutdatedBuildInterval: desktopOutput || desktopBuildDir ? false : 5 * 60_000,
    // Existing proxy, storage and WebSocket routes use Nitro 2's H3 helpers.
    nitroAutoImports: true,
    // Keep profiling opt-in instead of accumulating hook measurements during long sessions.
    browserDevtoolsTiming: false,
  },
  // Baseline hardening for every response. The Content-Security-Policy is added to the page by
  // server/plugins/security.ts, which hashes the inline scripts it contains.
  routeRules: {
    '/**': {
      headers: {
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
    '/sw.js': { headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } },
    '/api/v1/link-media/widgets/**': {
      headers: { 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'private, no-store' },
    },
    '/manifest.webmanifest': { headers: { 'Cache-Control': 'no-cache' } },
    '/robots.txt': { headers: { 'Cache-Control': 'no-cache' } },
    '/build-info/changelog.json': { headers: { 'Cache-Control': 'no-cache' } },
    // Brand artwork keeps its URL across releases; revalidate so a changed icon is picked up.
    '/favicon.svg': { headers: { 'Cache-Control': 'no-cache' } },
    '/icons/**': { headers: { 'Cache-Control': 'no-cache' } },
    // The default avatar list grows over releases; the images themselves keep their URLs.
    '/avatars/defaults/manifest.json': { headers: { 'Cache-Control': 'no-cache' } },
    // Read-aloud's voice model engine and control files: versioned paths, never changed in place.
    // The workers get their own policy: script from here only, and fetches here or to the Hub.
    '/speech/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': `default-src 'none'; script-src 'self'; connect-src 'self' ${localSpeechHosts.join(' ')}`,
      },
    },
  },
  // The release this build was made from (the image's VERSION build argument), bundled into the
  // client so a running page knows its own version. Empty for development builds.
  appConfig: {
    release: { version: process.env.IRCORD_VERSION ?? '' },
    collaborators,
  },
  runtimeConfig: {
    backendUrl: 'http://127.0.0.1:8080',
    siteUrl: '',
    demo: false,
    public: {
      // Go/Huma contract (chat, networks, history, realtime).
      apiBase: '/api/v1',
      // Demo fixture routes for account settings and the picker library.
      appApiBase: '/api/app',
      demo: false,
      websocketUrl: '',
      // Public links can name the instance while the desktop UI uses its local origin.
      instanceUrl: '',
      klipyApiKey: '',
      // Public JSON connection presets; never include passwords here.
      networkPresets: '',
      firstConnectionGuide: true,
      // Read-aloud's voice model on this device: browsers download it from Hugging Face, so the
      // page may connect there. NUXT_PUBLIC_LOCAL_SPEECH=false removes the option and the hosts.
      localSpeech: true,
    },
  },
  hooks: {
    'build:manifest'(manifest) {
      // The artwork engine is only used by visible link cards without images.
      for (const [source, chunk] of Object.entries(manifest))
        if (source.includes('/node_modules/satori/')) chunk.prefetch = false
      // The diagram frame's script (Mermaid) loads when the first diagram comes into view.
      for (const chunk of Object.values(manifest))
        if (chunk.file.startsWith('diagram-frame-')) chunk.prefetch = false
    },
    'nitro:config'(nitro) {
      const dir = resolve(nitro.buildDir ?? '.nuxt', 'build-info')
      nitro.publicAssets = [...(nitro.publicAssets ?? []), { dir, baseURL: '/build-info' }]
      if (nitro.dev && process.env.IRCORD_DESKTOP_DEV_DIR) {
        const setup =
          process.env.IRCORD_DESKTOP_SETUP_DIR ??
          fileURLToPath(new URL('../desktop/setup', import.meta.url))
        nitro.publicAssets.push({ dir: setup, baseURL: '/desktop-setup' })
      }
    },
    async 'nitro:build:before'({ options }) {
      const directory = options.publicAssets.find((asset) => asset.baseURL === '/build-info')!.dir
      const data = await readFile(
        new URL('./server/assets/changelog.json', import.meta.url),
        'utf8',
      )
        .then((raw) => JSON.parse(raw) as { releases?: Changelog['releases'] })
        .catch(() => null)
      const changelog: Changelog = {
        buildId: options.runtimeConfig.app.buildId ?? 'dev',
        version: process.env.IRCORD_VERSION ?? '',
        releases: Array.isArray(data?.releases) ? data.releases : [],
      }
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, 'changelog.json'), JSON.stringify(changelog))
    },
    // Keep native file routing while loading every workspace page with the app.
    'pages:extend'(pages) {
      function eager(pages: NuxtPage[]) {
        for (const page of pages) {
          page._sync = true
          if (page.children) eager(page.children)
        }
      }
      eager(pages)
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'IRCord',
      // viewport-fit=cover lets the layout use safe-area insets (notches, home indicator);
      // resizes-content keeps the composer above the on-screen keyboard.
      viewport: [
        'width=device-width, initial-scale=1, viewport-fit=cover',
        ...(!desktopOutput && !desktopBuildDir ? ['interactive-widget=resizes-content'] : []),
      ].join(', '),
      meta: [
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'theme-color', content: '#1b1b21' },
        // Installed (Home Screen) app on iOS, required there for Web Push.
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'IRCord' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      // Applies the saved appearance before first paint so there is no theme flash.
      script: [{ innerHTML: appearanceBootScript, tagPosition: 'head' }],
      // Generate fallback variables from the same source as saved themes. The pre-paint
      // stylesheet uses :root:root, so a saved appearance always outranks these defaults.
      style: [
        {
          key: 'appearance-defaults',
          // Tauri adds a nonce to this stylesheet. Place it before the inline script (priority 50).
          tagPriority: 45,
          innerHTML: compileAppearance(defaultAppearance, 'dark').css.replace(
            ':root:root',
            ':root',
          ),
        },
      ],
    },
  },
})
