/**
 * GET /api/datafile?url=<absolute upstream URL>&offset=<bytes>&length=<bytes>
 *
 * A CORS-friendly Range proxy for public radio-astronomy filterbank data.
 *
 * The browser cannot fetch from Berkeley SETI's HTTP hosts directly because
 * those hosts do not set `Access-Control-Allow-Origin`. This Pages Function
 * forwards a single ranged GET to the upstream, then re-emits the bytes with
 * CORS headers attached so the SPA can stream them into the analysis worker.
 *
 * Security model:
 *  - Host allowlist only — see `ALLOWED_HOSTS` below. Any URL outside that
 *    set is rejected with 403, so this Function cannot be used as a general-
 *    purpose Internet relay.
 *  - Range length is hard-capped at 64 MiB per request to bound egress.
 *  - Method is GET-only. No body forwarding.
 *  - User-controlled URL is the *only* parameter that selects upstream, and
 *    its protocol must be http: or https:.
 */

interface ProxyEnv {
  // Reserved for future env-driven config. Empty today.
}

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // Berkeley SETI public-data hosts (blpd0 .. blpd14 — the full BL data farm)
  'blpd0.ssl.berkeley.edu',
  'blpd1.ssl.berkeley.edu',
  'blpd2.ssl.berkeley.edu',
  'blpd3.ssl.berkeley.edu',
  'blpd4.ssl.berkeley.edu',
  'blpd5.ssl.berkeley.edu',
  'blpd6.ssl.berkeley.edu',
  'blpd7.ssl.berkeley.edu',
  'blpd8.ssl.berkeley.edu',
  'blpd9.ssl.berkeley.edu',
  'blpd10.ssl.berkeley.edu',
  'blpd11.ssl.berkeley.edu',
  'blpd12.ssl.berkeley.edu',
  'blpd13.ssl.berkeley.edu',
  'blpd14.ssl.berkeley.edu',
  'bldata.berkeley.edu',
  'seti.berkeley.edu',
  // Breakthrough Initiatives mirrors
  'breakthroughinitiatives.org',
  // Some BL tutorial data is mirrored on GCS
  'storage.googleapis.com'
]);

const MAX_RANGE_BYTES = 64 * 1024 * 1024; // 64 MiB
const DEFAULT_LENGTH = 4096;

export const onRequestGet: PagesFunction<ProxyEnv> = async ({ request }) => {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url');
  if (!target) return jsonError('Missing required ?url= parameter', 400);

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return jsonError('Malformed ?url= value', 400);
  }
  if (upstreamUrl.protocol !== 'http:' && upstreamUrl.protocol !== 'https:') {
    return jsonError('Only http(s) upstream URLs are allowed', 400);
  }
  if (!ALLOWED_HOSTS.has(upstreamUrl.hostname)) {
    return jsonError(`Upstream host "${upstreamUrl.hostname}" is not on the allowlist`, 403);
  }

  const offset = Math.max(0, parseInt(reqUrl.searchParams.get('offset') ?? '0', 10) || 0);
  const requestedLength =
    parseInt(reqUrl.searchParams.get('length') ?? `${DEFAULT_LENGTH}`, 10) || DEFAULT_LENGTH;
  const length = Math.min(MAX_RANGE_BYTES, Math.max(1, requestedLength));

  const rangeHeader = `bytes=${offset}-${offset + length - 1}`;
  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Range: rangeHeader,
        Accept: 'application/octet-stream',
        // Identify ourselves clearly in upstream logs — courteous to Berkeley.
        'User-Agent': 'SignalScope-SETI-Proxy/1.0 (+citizen-science)'
      },
      // Cloudflare's fetch caches by default; keep that on so repeated reads
      // of the same byte range don't re-pull from Berkeley.
      cf: { cacheTtl: 86400, cacheEverything: true } as RequestInitCfProperties
    });
  } catch (e) {
    return jsonError(
      `Upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      502
    );
  }

  if (!upstreamResp.ok && upstreamResp.status !== 206) {
    return jsonError(
      `Upstream returned ${upstreamResp.status} ${upstreamResp.statusText}`,
      502
    );
  }

  const respHeaders = new Headers();
  respHeaders.set('Content-Type', 'application/octet-stream');
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  respHeaders.set('Cache-Control', 'public, max-age=86400, immutable');
  const cLen = upstreamResp.headers.get('Content-Length');
  if (cLen) respHeaders.set('Content-Length', cLen);
  const cRange = upstreamResp.headers.get('Content-Range');
  if (cRange) respHeaders.set('Content-Range', cRange);

  return new Response(upstreamResp.body, {
    status: 200,
    headers: respHeaders
  });
};

export const onRequestOptions: PagesFunction<ProxyEnv> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
      'Access-Control-Max-Age': '86400'
    }
  });
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
