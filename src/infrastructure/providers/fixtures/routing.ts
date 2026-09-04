/**
 * Deterministic HTTP stub shared by provider/import tests (Feature 007).
 *
 * Routes URL → { status, body } so adapters (which receive an injected
 * fetch) can be exercised without real network or MSW handlers. Recorded
 * requests are exposed for assertions on query params.
 */

export interface RouteResponse {
  readonly status?: number;
  readonly body: string;
}

export interface RoutingFetch {
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Every requested URL in order. */
  readonly requestedUrls: string[];
}

/** Route responses by exact URL match (or prefix when the key ends with `*`). */
export function createRoutingFetch(
  routes: ReadonlyArray<readonly [key: string, body: string]>,
): RoutingFetch {
  const requestedUrls: string[] = [];
  const fetchFn: RoutingFetch['fetch'] = async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    requestedUrls.push(url);
    for (const [key, body] of routes) {
      if (key.endsWith('*')) {
        if (url.startsWith(key.slice(0, -1))) {
          return new Response(body, { status: 200 });
        }
      } else if (url === key) {
        return new Response(body, { status: 200 });
      }
    }
    return new Response('Not found', { status: 404 });
  };
  return { fetch: fetchFn, requestedUrls };
}
