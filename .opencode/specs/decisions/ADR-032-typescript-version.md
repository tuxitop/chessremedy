# ADR-032: TypeScript Version Policy

## Status

Accepted

## Decision

ChessRemedy tracks the **latest stable TypeScript release that the current
`typescript-eslint` toolchain supports**. The installed TypeScript stays within
the `peerDependencies` range declared by the installed `typescript-eslint`
package (`>= 4.8.4 < 6.1.0` at the time of writing).

When a new TypeScript major is published, ChessRemedy does **not** bump
TypeScript until `typescript-eslint` publishes a release whose peer range
includes it. At that point the bump happens as part of normal Dependency
policy maintenance (`AGENTS.md` — latest stable by default).

This is a deliberate exception to the AGENTS.md Dependency policy rule "latest
stable by default". It is a toolchain compatibility constraint: the latest
stable TypeScript (major 7, the native compiler) is incompatible with the
latest stable `typescript-eslint` (which caps its peer range below it), and
`typescript-eslint` has no newer release that lifts the cap. No override,
force-install, or peer-range suppression is used: an override would install a
compiler the linter cannot parse, degrading the lint gate instead of enabling
it.

The exact TypeScript version is not recorded here — it lives in
`package.json` / the lockfile (AGENTS.md Dependency policy; the lockfile is the
source of truth). This ADR only records the **policy** and the reason it exists.

## Reasons

- `typescript-eslint` provides the type-aware linting the Execution policy
  gate (`npm run lint`) depends on.
- TypeScript 7 is the native (Go) compiler; while `tsc` compatibility is
  planned, the ESLint plugin ecosystem must parse code with the TypeScript
  compiler API. Upgrading TypeScript ahead of the parser is unsafe.
- Keeping the pair aligned avoids ERESOLVE peer conflicts in `npm install` and
  keeps `npm audit` / `npm run build` gates green without suppressions.

## Consequences

- The TypeScript major is tied to the `typescript-eslint` peer range; upgrades
  of one are reviewed together with the other.
- Agents must not bump TypeScript to a major outside the installed
  `typescript-eslint` peer range. Re-check this decision whenever either
  package releases a new major.

## Sources

- `AGENTS.md` (Dependency policy, Execution policy)
- `typescript-eslint` npm `peerDependencies`
- `typescript` npm `dist-tags` (`latest`)
