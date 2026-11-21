# IRCord frontend

The Nuxt application serves the chat client and proxies its requests to the
backend. Use Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run dev
```

The development client listens on port 3000. Use the
[development environment](https://github.com/ircord/dev-environment) to start
both services and run the browser integration checks.

Run lint, type checking, unit tests, and the build with `bun run lint`,
`bun run typecheck`, `bun run test:unit`, and `bun run build`.

Run `bun run api:generate` when the backend contract changes. It reads
`../backend/openapi.json` by default. Set `IRCORD_OPENAPI` to the absolute path
of a different OpenAPI file.

Update `CHANGELOG.md` for changes people using the app can see. Push a version
tag in this repository to build and publish `ghcr.io/ircord/ircord-frontend`.

After a stable frontend release publishes, its workflow dispatches the desktop release with the same tag.
Set the `DESKTOP_RELEASE_TOKEN` repository secret to a credential with Actions write access to `ircord/desktop`.
