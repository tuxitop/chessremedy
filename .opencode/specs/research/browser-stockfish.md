# Browser Stockfish Research

## Question

How should ChessRemedy configure Stockfish in the browser using WebAssembly
and Web Workers for local-first analysis, tactical detection, and puzzle
generation?

## Sources

### Primary

- `@lichess-org/stockfish-web` npm package and GitHub repository
  (https://github.com/lichess-org/stockfish-web)
- `stockfish` npm package (nmrugg/stockfish.js)
  (https://github.com/nmrugg/stockfish.js)
- `stockfish.wasm` npm package (lichess-org/stockfish.wasm)
  (https://github.com/lichess-org/stockfish.wasm)
- Official Stockfish repository (https://github.com/official-stockfish/Stockfish)
- Stockfish UCI documentation
  (https://official-stockfish.github.io/docs/stockfish-wiki/UCI-%26-Commands.html)
- npm registry pages for all stockfish-related packages

### Secondary

- Can I Use: SharedArrayBuffer
  (https://caniuse.com/sharedarraybuffer)
- MDN Web Docs: SharedArrayBuffer
  (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- Safari 15.2 Release Notes (COOP/COEP support)
  (https://developer.apple.com/documentation/safari-release-notes/safari-15_2-release-notes)
- DeepWiki: Stockfish UCI Options and Configuration
  (https://deepwiki.com/official-stockfish/Stockfish/6.2-uci-options-and-configuration)

---

## Findings

### Candidate 1: `stockfish` (nmrugg/stockfish.js)

**Repository:** https://github.com/nmrugg/stockfish.js
**Stars:** ~1,200
**License:** GPLv3
**Author:** Nathan Rugg (Chess.com sponsored)

**Current stable version (2026):** 18.0.8 (published June 15, 2026)

**Based on:** Stockfish 18 (official upstream)

**Flavors:**

| Flavor | WASM Size | Threading | SharedArrayBuffer Required | Use Case |
|--------|-----------|-----------|--------------------------|----------|
| Large multi-threaded | ~100MB | Multi-threaded | Yes (COOP/COEP) | Desktop, strongest |
| Large single-threaded | ~100MB | Single-threaded | No | Desktop without COOP/COEP |
| Lite multi-threaded | ~7MB | Multi-threaded | Yes (COOP/COEP) | Mobile with CORS |
| Lite single-threaded | ~7MB | Single-threaded | No | Mobile without CORS |
| ASM.js | ~10MB | Single-threaded | No | Legacy browsers |

**Threading model:**
- Multi-threaded builds use SharedArrayBuffer for WASM threading
- Single-threaded builds run without SharedArrayBuffer
- The single-threaded builds cannot use `setoption name Threads value N`

**SIMD support:** Not documented explicitly; likely not included in the WASM
builds (Emscripten default for broad compatibility).

**Memory/hash configuration:**
- `setoption name Hash value N` supported (UCI standard)
- Hash range depends on the build; default 16 MB, max depends on memory
  allocation

**Mobile browser compatibility:**
- iOS Safari 16+ supported for WASM
- SharedArrayBuffer available on iOS Safari 15.2+ with COOP/COEP headers
- The lite single-threaded build is explicitly recommended for mobile

**Vite integration:**
- Place WASM and JS files in `public/` directory
- Load via `new Worker(new URL('./stockfish.js', import.meta.url))`
- For multi-threaded builds, add COOP/COEP headers in Vite config:
  ```js
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
  ```

**API surface:**
- Full UCI protocol support
- `setoption name Threads value N` (multi-threaded builds only)
- `setoption name Hash value N`
- `setoption name MultiPV value N`
- `setoption name UCI_ShowWDL value true` (WDL output)
- `stop` command for cancellation
- `go depth N`, `go movetime N`, `go nodes N` supported

**MultiPV support:** Yes, up to 500 (Stockfish UCI max)

**Weekly downloads:** ~27,958 (highest among all candidates)

**Known limitations:**
- Large builds are >100MB (slow to load)
- Lite builds are weaker but still superhuman
- Multi-threaded builds require COOP/COEP headers
- No explicit SIMD support in published builds

---

### Candidate 2: `@lichess-org/stockfish-web`

**Repository:** https://github.com/lichess-org/stockfish-web
**Stars:** ~44 (growing)
**License:** AGPL-3.0-or-later (npm package), GPLv3 (Stockfish itself)
**Author:** Lichess (T-bone Duplexus / niklasf)

**Current stable version (2026):** 0.4.2 (published July 13, 2026)

**Builds included:**

| Build | WASM Size | Based On | SIMD |
|-------|-----------|----------|------|
| sf_18.wasm | 587.7KB | Stockfish 18 | No |
| sf_18_relaxed-simd.wasm | 588.0KB | Stockfish 18 | Relaxed SIMD |
| sf_18_smallnet.wasm | 582.3KB | Stockfish 18 (small net) | No |
| sf_18_smallnet_relaxed-simd.wasm | 582.4KB | Stockfish 18 (small net) | Relaxed SIMD |
| sf_dev.wasm | 550.0KB | Stockfish dev-20260609 | No |
| sf_dev_relaxed-simd.wasm | 549.5KB | Stockfish dev-20260609 | Relaxed SIMD |
| fsf_14.wasm | 715.0KB | Fairy-Stockfish 14 | No |

**Threading model:**
- All builds are single-threaded Web Workers
- No SharedArrayBuffer required
- No dynamic `import()` in WebWorker (static loading only)

**SIMD support:**
- Relaxed SIMD builds available for sf_18 and sf_dev
- Relaxed SIMD supported in Chrome 91+, Edge 91+, Firefox 89+, Safari 16.4+
- Graceful fallback to non-SIMD builds possible

**Memory/hash configuration:**
- `setoption name Hash value N` supported
- Hash limited by WASM memory allocation (typically 256MB-1GB default)

**Mobile browser compatibility:**
- Works on iOS Safari 16+ (no SharedArrayBuffer needed)
- Works on Android Chrome
- Relaxed SIMD requires Safari 16.4+ (iOS 16.4+)

**Vite integration:**
- More complex than stockfish.js
- Multiple WASM files and JS glue files
- NNUE network files must be loaded separately (fetched from Stockfish servers
  or bundled)
- The README explicitly states: "This package is optimized for the lichess.org
  website, which needs multiple builds and chess variants. It is not
  straight-forward to load and use."

**API surface:**
- Full UCI protocol
- `setoption name Threads value N` (accepted but limited by single-threaded build)
- `setoption name Hash value N`
- `setoption name MultiPV value N`
- `setoption name UCI_ShowWDL value true`
- `stop` command for cancellation

**MultiPV support:** Yes

**Weekly downloads:** ~12,500

**Known limitations:**
- Not designed for external consumption (optimized for Lichess)
- Multiple builds increase package complexity
- NNUE files require dynamic loading or bundling
- AGPL-3.0 license on the npm package (Stockfish itself is GPLv3)
- Documentation explicitly warns it is "not straight-forward to load and use"

---

### Candidate 3: `stockfish.wasm` (lichess-org/stockfish.wasm)

**Repository:** https://github.com/lichess-org/stockfish.wasm
**Stars:** ~337
**License:** GPLv3
**Author:** Niklas Fiekas (lichess)

**Current stable version:** 0.10.0 (published February 23, 2021)

**Status:** PASSIVELY MAINTAINED - superseded by stockfish-web

**Based on:** SF_classical (handcoded eval, pre-NNUE)

**Threading model:**
- Multi-threaded with SharedArrayBuffer
- Requires COOP/COEP headers

**WASM size:** ~400KB total (stockfish.js + stockfish.wasm + stockfish.worker.js)

**Mobile browser compatibility:**
- SharedArrayBuffer required (iOS Safari 15.2+ with COOP/COEP)
- Not recommended for mobile

**Known limitations:**
- Based on SF_classical (significantly weaker than NNUE versions)
- Last updated 2021
- No SIMD
- Explicitly marked as "Passively maintained"
- Superseded by stockfish-web

**Verdict:** NOT RECOMMENDED - outdated and weaker engine

---

### Candidate 4: `stockfish.js` (lichess-org/stockfish.js)

**Repository:** https://github.com/lichess-org/stockfish.js
**Stars:** ~240
**License:** GPLv3
**Author:** Niklas Fiekas (lichess)

**Current stable version:** Last release ddugovic-250718 (July 2018)

**Status:** MAINTAINED WITH BUGFIXES ONLY - active development on stockfish-web

**Based on:** Stockfish 10

**Threading model:**
- Pure JavaScript or WebAssembly without shared memory
- Single-threaded only

**WASM size:** ~400KB total

**Mobile browser compatibility:**
- Works everywhere JavaScript runs
- No SharedArrayBuffer needed

**Known limitations:**
- Stockfish 10 (significantly weaker than Stockfish 18)
- No NNUE support
- No SIMD
- Single-threaded only
- Only maintained for legacy browser support

**Verdict:** NOT RECOMMENDED - outdated engine version

---

### Candidate 5: `stockfish-nnue.wasm` (hi-ogawa/Stockfish)

**Repository:** https://github.com/hi-ogawa/Stockfish
**npm:** stockfish-nnue.wasm
**License:** GPLv3

**Status:** Referenced in lichess-org/stockfish-web as older compatibility build

**Based on:** Stockfish 14 with NNUE

**Known limitations:**
- Stockfish 14 (weaker than Stockfish 18)
- No dynamic `import()` in WebWorker

**Verdict:** NOT RECOMMENDED - superseded by stockfish-web

---

### SharedArrayBuffer Browser Support (2026)

**Desktop browsers:**
- Chrome 68+: Full support with COOP/COEP
- Edge 79+: Full support with COOP/COEP
- Firefox 79+: Full support with COOP/COEP
- Safari 15.2+: Full support with COOP/COEP

**Mobile browsers:**
- iOS Safari 15.2+: Supported with COOP/COEP headers
- iOS Safari 16.4+: Atomics no longer gated behind COOP/COEP for some features
- Android Chrome: Supported with COOP/COEP

**Key requirement:** Cross-Origin Isolation via HTTP headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**For a local-first SPA:**
- COOP/COEP headers can be set in development (Vite config)
- For production deployment, the hosting provider must support these headers
- Static hosting (GitHub Pages, Netlify, Vercel) can be configured to send
  these headers

---

### Stockfish UCI Options Reference

From official Stockfish documentation:

| Option | Type | Default | Min | Max | Description |
|--------|------|---------|-----|-----|-------------|
| Threads | spin | 1 | 1 | 1024 | Number of threads |
| Hash | spin | 16 | 1 | 33554432 | Hash size in MB |
| MultiPV | spin | 1 | 1 | 500 | Number of principal variations |
| UCI_ShowWDL | check | false | - | - | Show win/draw/loss statistics |
| Skill Level | spin | 20 | 0 | 20 | Playing strength |
| UCI_LimitStrength | check | false | - | - | Limit engine strength |
| UCI_Elo | spin | 1320 | 1320 | 3190 | Elo rating limit |
| Ponder | check | false | - | - | Let engine ponder on opponent's time |
| Move Overhead | spin | 10 | 0 | 5000 | Time overhead in ms |

**WDL output format:**
```
info depth 5 score cp 18 wdl 22 974 4 pv e2e4
```
Where wdl = win.draw.loss in per-mille (out of 1000).

**Cancellation:** Send `stop` command to abort current search. Engine responds
with `bestmove` of current best line.

---

## Analysis Profiles

### Profile 1: Fast Bulk Analysis

**Purpose:** Batch process many positions quickly (e.g., initial game import,
quick evaluation of all moves)

**Configuration:**
```
setoption name Threads value 1
setoption name Hash value 16
setoption name MultiPV value 1
go depth 10
```

**Rationale:**
- Depth 10 provides quick evaluation (~100-500ms per position)
- 16 MB hash is sufficient for shallow search
- Single thread avoids SharedArrayBuffer requirement
- MultiPV 1 for speed (only need best move)

**Alternative (time-limited):**
```
go movetime 500
```

### Profile 2: Normal Analysis

**Purpose:** Standard single-position analysis for game review

**Configuration:**
```
setoption name Threads value 1
setoption name Hash value 64
setoption name MultiPV value 1
setoption name UCI_ShowWDL value true
go depth 20
```

**Rationale:**
- Depth 20 provides strong analysis (~5-30 seconds per position)
- 64 MB hash for deeper search
- WDL output for win/draw/loss assessment
- Single thread for mobile compatibility

### Profile 3: Tactical Candidate Generation

**Purpose:** Find candidate tactics using multiple principal variations

**Configuration:**
```
setoption name Threads value 1
setoption name Hash value 128
setoption name MultiPV value 5
setoption name UCI_ShowWDL value true
go depth 22
```

**Rationale:**
- MultiPV 5 finds alternative lines (tactical candidates often not the
  engine's first choice)
- Depth 22 for tactical vision
- 128 MB hash for multi-line search
- WDL helps assess tactical sharpness

### Profile 4: Deep Puzzle Verification

**Purpose:** Confirm puzzle correctness and verify tactical objectives

**Configuration:**
```
setoption name Threads value 1
setoption name Hash value 256
setoption name MultiPV value 3
setoption name UCI_ShowWDL value true
go depth 30
```

**Rationale:**
- Depth 30 for deep tactical verification
- 256 MB hash for deep search
- MultiPV 3 to verify no better alternatives exist
- WDL for objective assessment
- May use `go nodes 10000000` as alternative (10M nodes)

---

## Comparison Table

| Feature | stockfish (nmrugg) | @lichess-org/stockfish-web | stockfish.wasm | stockfish.js |
|---------|-------------------|---------------------------|----------------|--------------|
| **Version** | 18.0.8 | 0.4.2 | 0.10.0 | ddugovic |
| **Stockfish Base** | SF 18 | SF 18 / dev | SF_classical | SF 10 |
| **License** | GPLv3 | AGPL-3.0 | GPLv3 | GPLv3 |
| **WASM Size (smallest)** | ~7MB | ~550KB | ~400KB | ~400KB |
| **WASM Size (full)** | ~100MB | ~588KB | ~400KB | ~400KB |
| **Threading** | Multi/Single | Single | Multi | Single |
| **SharedArrayBuffer** | Optional | Not required | Required | Not required |
| **SIMD** | No | Relaxed SIMD | No | No |
| **NNUE** | Yes | Yes | No (classical) | No |
| **MultiPV** | Yes (500) | Yes | Yes | Yes |
| **WDL** | Yes | Yes | No | No |
| **Threads option** | Multi only | Accepted (no effect) | Yes | No |
| **Hash option** | Yes | Yes | Yes | Yes |
| **Mobile** | Yes (lite/single) | Yes | Limited | Yes |
| **iOS Safari** | 16+ | 16+ | 15.2+ (COOP/COEP) | 10+ |
| **npm weekly downloads** | 27,958 | 12,500 | 1,536 | 3,271 |
| **Maintenance** | Active | Active | Passive | Bugfixes only |
| **Vite integration** | Simple | Complex | Moderate | Simple |
| **Documentation** | Good | Warns complexity | Good | Good |

---

## Limitations

1. **No Stockfish WASM build supports true multi-threading without
   SharedArrayBuffer.** All multi-threaded builds require COOP/COEP headers.

2. **The "lite" builds in stockfish.js are weaker than full builds.** The
   small NNUE network trades strength for size. For most human analysis
   purposes, this difference is negligible.

3. **WDL model is approximate.** The win/draw/loss statistics are based on
   fishtest LTC data and may not accurately reflect all positions.

4. **WASM memory allocation is fixed at load time.** Hash size cannot exceed
   the allocated WASM memory. This limits maximum hash on mobile devices.

5. **iOS Safari SharedArrayBuffer support requires COOP/COEP headers** even
   in 2026. This complicates deployment on some static hosts.

6. **No npm package provides a ready-to-use Web Worker wrapper.** All
   candidates require manual Worker setup and UCI message handling.

7. **NNUE network loading varies by package.** stockfish.js bundles the
   network in the WASM binary; @lichess-org/stockfish-web loads it
   separately.

---

## Recommendation

### Primary recommendation: `stockfish` (nmrugg/stockfish.js) v18.0.8

**Specific builds to use:**

1. **Primary (default):** `stockfish-18-lite-single.wasm` (~7MB)
   - No SharedArrayBuffer required
   - Works on iOS Safari 16+
   - Superhuman strength (adequate for all analysis profiles)
   - Fast loading

2. **Enhanced (when COOP/COEP available):** `stockfish-18-lite.wasm` (~7MB)
   - Multi-threaded with SharedArrayBuffer
   - Faster analysis with multiple threads
   - Same strength as single-threaded lite

3. **Full strength (desktop only, optional):** `stockfish-18.wasm` (~100MB)
   - Full NNUE network
   - Strongest analysis
   - Slow to load; use only for deep puzzle verification if needed

### Reasoning

**Analysis profile support:**
- All four profiles (fast bulk, normal, tactical, deep) are supported via
  UCI options (depth, MultiPV, Hash)
- The lite engine is more than sufficient for tactical detection at any
  depth ChessRemedy would use
- MultiPV 5+ is supported for tactical candidate generation

**Mobile browser compatibility:**
- The single-threaded lite build works on iOS Safari 16+ without any
  special headers
- Android Chrome supports both single and multi-threaded builds
- No SharedArrayBuffer requirement for the default build

**Vite integration ease:**
- Place WASM and JS files in `public/stockfish/`
- Load via `new Worker(new URL('/stockfish/stockfish-18-lite-single.js',
  import.meta.url))`
- No special headers required for single-threaded build
- For multi-threaded build, add COOP/COEP headers in Vite config (optional
  enhancement)

**License compatibility:**
- GPLv3 is compatible with ChessRemedy's license (if open source)
- If ChessRemedy is proprietary, GPLv3 requires source disclosure
- Alternative: Use the single-threaded build which is a "system library"
  exception under GPLv3

**Maintenance and future stability:**
- 27,958 weekly npm downloads (most popular)
- Sponsored by Chess.com (long-term funding)
- Tracks official Stockfish releases (currently Stockfish 18)
- Active maintenance with regular updates

**SharedArrayBuffer is optional:**
- Default to single-threaded builds (no COOP/COEP required)
- Detect SharedArrayBuffer availability at runtime
- Upgrade to multi-threaded build when available
- This provides the best mobile compatibility

### Version strategy

- Pin to `stockfish@18.0.8` for V1
- Track Stockfish major versions (18, 19, 20...) for upgrades
- Test new versions before upgrading (Stockfish strength can vary between
  releases for specific position types)

---

## Impact on ChessRemedy

### Architecture impact

1. **Engine service layer:** Must support loading different WASM builds
   based on browser capability detection.

2. **Worker pool:** Can create multiple Workers for parallel analysis
   (e.g., analyzing multiple positions simultaneously).

3. **Analysis profiles:** Map directly to UCI option configurations.
   The engine service should accept a profile name and apply the
   corresponding settings.

4. **Capability detection:** At startup, detect:
   - SharedArrayBuffer availability
   - WebAssembly SIMD support
   - Available memory (for hash sizing)

5. **Progressive enhancement:**
   - Default: single-threaded lite build
   - Enhanced: multi-threaded lite build (if COOP/COEP available)
   - Full: multi-threaded full build (desktop, optional)

### Implementation considerations

1. **WASM loading:** The WASM files should be served from the same origin
   or with proper CORS headers. Place in `public/` directory.

2. **NNUE network:** The stockfish.js builds bundle the NNUE network in
   the WASM binary. No separate network loading required.

3. **Message protocol:** UCI commands are sent as strings via
   `worker.postMessage()`. Responses are received via
   `worker.onmessage`.

4. **Cancellation:** Send `stop` command to abort. The engine will respond
   with `bestmove` of the current best line.

5. **Error handling:** Implement timeout for engine responses. If no
   response within reasonable time, terminate and restart worker.

6. **Memory management:** Limit hash size based on available device memory.
   On mobile, cap at 64MB. On desktop, allow up to 256MB.

---

## Open questions

1. **Should ChessRemedy ship both single-threaded and multi-threaded builds
   to support all browsers?** The size overhead is ~7MB additional. This
   would provide the best experience on desktop while maintaining mobile
   compatibility.

2. **Should the full-strength build (~100MB) be available for deep puzzle
   verification?** The lite build may miss some deep tactical nuances,
   but this is unlikely for positions within human play range.

3. **How should analysis results be cached?** The same position may be
   analyzed multiple times (e.g., during import and later during review).
   A position hash -> analysis cache in IndexedDB would avoid redundant
   computation.

4. **What is the maximum concurrent Workers supported on mobile?** iOS
   Safari may limit the number of Web Workers. Testing required.

5. **Should WDL be stored alongside centipawn evaluation?** WDL provides
   more intuitive win/draw/loss assessment but requires storage of
   three additional values per position.

6. **How to handle engine version upgrades?** When Stockfish 19 is released,
   should existing analyses be re-run? The architecture spec calls for
   versioning engine name/version, but re-analysis is expensive.

7. **License implications:** GPLv3 requires source disclosure for distributed
   binaries. If ChessRemedy is distributed as a web app, the WASM files
   are part of the distribution. Consult legal counsel on whether the
   "system library" exception applies to WASM builds loaded at runtime.
