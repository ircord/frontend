// Vendors the end-to-end encryption core's WebAssembly package for the web client.
//
// IRCord's encryption core (github.com/ircord/e2ee) is one Rust library with a wasm package. The
// web client runs that package in a worker (app/workers/e2ee.worker.ts). This script builds the
// web package at a pinned commit with the core's own toolchain script, tools/wasm.sh (which runs
// in a container when the wasm toolchain is not installed), and copies it to app/e2ee/vendor/.
//
// Usage, from the repository root:
//   bun scripts/vendor-e2ee.mjs                  clone the pinned commit, build, then write
//   bun scripts/vendor-e2ee.mjs --core <dir>     build from an existing checkout of that commit
//   bun scripts/vendor-e2ee.mjs --check          verify the vendored files against SHA256SUMS
//
// To move to a newer core: change `commit` below, run without flags, review the binding's API
// (ircord_e2ee_wasm.d.ts) against app/workers/e2ee.worker.ts, then check encryption in a browser.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'https://github.com/ircord/e2ee.git'
const commit = '1c01f989770d4da6e8e42e28d65d14042200c624'
const files = [
  'ircord_e2ee_wasm.js',
  'ircord_e2ee_wasm.d.ts',
  'ircord_e2ee_wasm_bg.wasm',
  'ircord_e2ee_wasm_bg.wasm.d.ts',
]
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'app', 'e2ee', 'vendor')
const args = process.argv.slice(2)

function sums() {
  return files
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(out, name)))
          .digest('hex')}  ${name}\n`,
    )
    .join('')
}

function check() {
  const expected = readFileSync(join(out, 'SHA256SUMS'), 'utf8')
  if (sums() !== expected) {
    console.error('app/e2ee/vendor does not match its SHA256SUMS. Run bun scripts/vendor-e2ee.mjs.')
    process.exit(1)
  }
  const source = readFileSync(join(out, 'SOURCE'), 'utf8')
  if (!source.includes(commit)) {
    console.error(`app/e2ee/vendor was built from another commit than ${commit}.`)
    process.exit(1)
  }
  console.log(`app/e2ee/vendor matches ircord/e2ee ${commit.slice(0, 7)}.`)
}

function vendor() {
  const at = args.indexOf('--core')
  let core = at >= 0 ? args[at + 1] : undefined
  let scratch
  if (!core) {
    scratch = mkdtempSync(join(tmpdir(), 'ircord-e2ee-'))
    core = join(scratch, 'e2ee')
    execFileSync('git', ['clone', '--quiet', repository, core], { stdio: 'inherit' })
  }
  try {
    execFileSync('git', ['-C', core, 'checkout', '--quiet', commit], { stdio: 'inherit' })
    execFileSync(join(core, 'tools', 'wasm.sh'), ['build'], { stdio: 'inherit' })
    // tools/wasm.sh builds into target/pkg, or target/container/pkg when it ran in its container.
    const built = [
      join(core, 'target', 'pkg', 'web'),
      join(core, 'target', 'container', 'pkg', 'web'),
    ].find((dir) => existsSync(join(dir, files[0])))
    if (!built) throw new Error('tools/wasm.sh did not leave a web package')
    mkdirSync(out, { recursive: true })
    for (const name of files) copyFileSync(join(built, name), join(out, name))
    writeFileSync(
      join(out, 'SOURCE'),
      `ircord/e2ee ${commit}\nBuilt with tools/wasm.sh build (wasm-bindgen --target web).\nMIT licence: https://github.com/ircord/e2ee/blob/${commit}/LICENSE\n`,
    )
    writeFileSync(join(out, 'SHA256SUMS'), sums())
    console.log(`Vendored ircord/e2ee ${commit.slice(0, 7)} into app/e2ee/vendor.`)
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

if (args.includes('--check')) check()
else vendor()
