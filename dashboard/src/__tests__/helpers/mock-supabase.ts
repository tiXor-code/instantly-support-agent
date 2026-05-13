// Chainable Supabase client mock.
//
// Recipe: route handlers call something like
//   supabase.from('tickets').select('id').eq('external_id', x).maybeSingle()
//
// Real PostgrestQueryBuilder is "thenable" — every chained call returns a
// builder that can be awaited at any point and resolves to `{ data, error }`.
// This mock mirrors that shape. The caller registers per-table responses
// via `setTable('tickets', { ... })`. All chain methods are no-ops that
// return `this`. Awaiting the chain (or calling `.maybeSingle()` / `.single()`)
// resolves with the registered response.
//
// Calls are recorded in `calls[]` for assertions.

import { vi } from 'vitest';

export interface MockResponse {
  data?: unknown;
  error?: { message: string } | null;
}

export interface MockCall {
  table: string;
  method: string;
  args: unknown[];
}

interface TableConfig {
  // Response returned for terminal awaits / .single() / .maybeSingle()
  response?: MockResponse;
  // Function called per terminal-await for dynamic responses
  fn?: (calls: MockCall[]) => MockResponse;
}

export function createMockSupabase() {
  const tableConfigs = new Map<string, TableConfig>();
  const calls: MockCall[] = [];

  function setTable(table: string, response: MockResponse | TableConfig) {
    if ('fn' in response || 'response' in response) {
      tableConfigs.set(table, response as TableConfig);
    } else {
      tableConfigs.set(table, { response: response as MockResponse });
    }
  }

  function makeBuilder(table: string) {
    function record(method: string, args: unknown[]) {
      calls.push({ table, method, args });
    }
    function resolveTerminal(): Promise<MockResponse> {
      const cfg = tableConfigs.get(table);
      if (!cfg) return Promise.resolve({ data: null, error: null });
      if (cfg.fn) return Promise.resolve(cfg.fn(calls));
      return Promise.resolve(cfg.response || { data: null, error: null });
    }

    const handler: ProxyHandler<object> = {
      get(_target, prop: string | symbol) {
        if (prop === 'then') {
          // Thenable — allow awaiting the chain at any point.
          return (resolve: (v: MockResponse) => void, reject?: (e: unknown) => void) =>
            resolveTerminal().then(resolve, reject);
        }
        if (typeof prop === 'string') {
          if (prop === 'single' || prop === 'maybeSingle') {
            record(prop, []);
            return () => resolveTerminal();
          }
          // All other chain methods (select, insert, update, upsert, eq, in,
          // order, limit, gt, etc.) record + return the same proxy.
          return (...args: unknown[]) => {
            record(prop, args);
            return proxy;
          };
        }
        return undefined;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn(),
  };

  return { client, calls, setTable };
}
