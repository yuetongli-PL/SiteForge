import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELDS,
  NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION,
  assertNoNetworkCaptureSiteSemanticClassification,
  observedRequestFromNetworkCaptureEvent,
  observedRequestsFromNetworkCaptureEvents,
  responseSummariesFromNetworkCaptureEvents,
  responseSummaryFromNetworkCaptureEvent,
} from '../../src/domain/artifacts/network-capture.mjs';
import { writeApiCandidateArtifactsFromObservedRequests } from '../../src/domain/capabilities/api-discovery.mjs';
import { API_CANDIDATE_SCHEMA_VERSION } from '../../src/domain/capabilities/api-candidates.mjs';
import { assertSchemaCompatible } from '../../src/domain/schemas/compatibility-registry.mjs';
import {
  BrowserSession,
  createNetworkTracker,
} from '../../src/infra/browser/session.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
} from '../../src/domain/sessions/security-guard.mjs';

function createRequestWillBeSentEvent(overrides = {}) {
  return {
    method: 'Network.requestWillBeSent',
    params: {
      requestId: 'synthetic-request-1',
      type: 'XHR',
      wallTime: '2026-05-01T00:00:00.000Z',
      documentURL: 'https://example.invalid/page?access_token=synthetic-document-token',
      initiator: {
        type: 'script',
      },
      request: {
        method: 'POST',
        url: 'https://example.invalid/api/items?access_token=synthetic-network-token&safe=1',
        headers: {
          authorization: 'Bearer synthetic-network-token',
          cookie: 'SESSDATA=synthetic-network-sessdata',
          accept: 'application/json',
        },
        postData: JSON.stringify({
          csrf: 'synthetic-network-csrf',
          safe: true,
        }),
      },
      ...overrides.params,
    },
    ...overrides,
  };
}

function createResponseReceivedEvent({ params: overrideParams = {}, ...overrides } = {}) {
  return {
    method: 'Network.responseReceived',
    params: {
      requestId: 'synthetic-request-1',
      type: 'XHR',
      timestamp: '2026-05-02T04:20:00.000Z',
      response: {
        status: 200,
        mimeType: 'application/json',
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
      ...overrideParams,
    },
    ...overrides,
  };
}

function createCandidate(overrides = {}) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'synthetic-response-candidate',
    siteKey: 'example',
    status: 'candidate',
    endpoint: {
      method: 'GET',
      url: 'https://example.invalid/api/items?access_token=synthetic-response-candidate-token',
    },
    ...overrides,
  };
}

function createFakeCdpClient() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      listeners.set(eventName, handler);
      return () => {
        listeners.delete(eventName);
      };
    },
    emit(eventName, event) {
      listeners.get(eventName)?.(event);
    },
  };
}

test('NetworkCapture normalizes synthetic CDP request events into redacted observed requests', () => {
  const observed = observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent(), {
    siteKey: 'example',
    observedAt: '2026-05-01T00:00:01.000Z',
  });

  assert.equal(observed.schemaVersion, NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION);
  assert.equal(observed.siteKey, 'example');
  assert.equal(observed.status, 'observed');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.source, 'cdp.Network.requestWillBeSent');
  assert.equal(observed.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(observed.headers.cookie, REDACTION_PLACEHOLDER);
  assert.equal(observed.headers.accept, 'application/json');
  assert.match(observed.url, /safe=1/u);
  assert.equal(observed.url.includes('synthetic-network-token'), false);
  assert.equal(observed.evidence.documentUrl.includes('synthetic-document-token'), false);
  assert.equal(observed.body.includes('synthetic-network-csrf'), false);
  assert.equal(observed.redactionAudit.redactedPaths.includes('headers.authorization'), true);
  assert.equal(observed.redactionAudit.redactedPaths.includes('headers.cookie'), true);
  assert.equal(assertNoForbiddenPatterns(observed), true);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-token'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-sessdata'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-csrf'), false);
});

test('NetworkCapture observed requests do not classify site semantics', () => {
  const observed = observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-core-looking-request',
      type: 'Fetch',
      documentURL: 'https://synthetic.example.invalid/video/page?access_token=synthetic-document-token',
      request: {
        method: 'GET',
        url: 'https://synthetic.example.invalid/core/api/video/detail?access_token=synthetic-api-token',
        headers: {
          authorization: 'Bearer synthetic-api-token',
          accept: 'application/json',
        },
      },
    },
  }), {
    siteKey: 'synthetic-site',
    observedAt: '2026-05-01T00:00:02.000Z',
  });

  assert.equal(assertNoNetworkCaptureSiteSemanticClassification(observed), true);
  assert.equal(observed.evidence.resourceType, 'Fetch');
  for (const field of NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELDS) {
    assert.equal(JSON.stringify(observed).includes(`"${field}"`), false);
  }
  assert.equal(Object.hasOwn(observed, 'catalogEntry'), false);
  assert.equal(Object.hasOwn(observed, 'verificationStatus'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-api-token'), false);

  assert.throws(
    () => assertNoNetworkCaptureSiteSemanticClassification({
      ...observed,
      authStatus: 'authenticated',
    }),
    /must not classify site semantics: authStatus/u,
  );
  assert.throws(
    () => assertNoNetworkCaptureSiteSemanticClassification({
      ...observed,
      evidence: {
        ...observed.evidence,
        sitePageType: 'video-detail',
      },
    }),
    /must not classify site semantics: evidence\.sitePageType/u,
  );
});

test('NetworkCapture preserves transport surfaces as redacted observed evidence', () => {
  const websocket = observedRequestFromNetworkCaptureEvent({
    method: 'Network.webSocketCreated',
    params: {
      requestId: 'synthetic-websocket-request',
      url: 'wss://example.invalid/socket?access_token=synthetic-websocket-token',
    },
  }, {
    siteKey: 'example',
    observedAt: '2026-05-01T00:00:03.000Z',
  });
  const sse = observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-sse-request',
      type: 'EventSource',
      request: {
        method: 'GET',
        url: 'https://example.invalid/events?session_id=synthetic-sse-session',
        headers: {
          authorization: 'Bearer synthetic-sse-token',
        },
      },
    },
  }), {
    siteKey: 'example',
  });
  const preflight = observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-preflight-request',
      type: 'Preflight',
      request: {
        method: 'OPTIONS',
        url: 'https://example.invalid/api/items?csrf_token=synthetic-preflight-csrf',
        headers: {
          authorization: 'Bearer synthetic-preflight-token',
        },
      },
    },
  }), {
    siteKey: 'example',
  });
  const redirect = observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-redirect-request',
      request: {
        method: 'GET',
        url: 'https://example.invalid/api/redirected',
        headers: {},
      },
      redirectResponse: {
        status: 302,
        url: 'https://example.invalid/login?access_token=synthetic-redirect-token',
        mimeType: 'text/html',
        headers: {
          authorization: 'Bearer synthetic-redirect-token',
          cookie: 'SESSDATA=synthetic-redirect-sessdata',
        },
      },
    },
  }), {
    siteKey: 'example',
  });

  assert.equal(websocket.transport, 'websocket');
  assert.equal(websocket.resourceType, 'WebSocket');
  assert.equal(websocket.source, 'cdp.Network.webSocketCreated');
  assert.equal(websocket.evidence.event, 'Network.webSocketCreated');
  assert.equal(websocket.url.includes('synthetic-websocket-token'), false);
  assert.equal(sse.transport, 'sse');
  assert.equal(sse.resourceType, 'EventSource');
  assert.equal(sse.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(preflight.transport, 'preflight');
  assert.equal(preflight.evidence.preflight, true);
  assert.equal(redirect.transport, 'http');
  assert.deepEqual(redirect.evidence.redirect, {
    statusCode: 302,
    url: 'https://example.invalid/login?access_token=%5BREDACTED%5D',
    mimeType: 'text/html',
  });
  assert.equal(Object.hasOwn(redirect.evidence.redirect, 'headers'), false);
  assert.equal(Object.hasOwn(redirect.evidence.redirect, 'body'), false);
  assert.equal(JSON.stringify([websocket, sse, preflight, redirect]).includes('synthetic-websocket-token'), false);
  assert.equal(JSON.stringify([websocket, sse, preflight, redirect]).includes('synthetic-sse-session'), false);
  assert.equal(JSON.stringify([websocket, sse, preflight, redirect]).includes('synthetic-preflight-csrf'), false);
  assert.equal(JSON.stringify([websocket, sse, preflight, redirect]).includes('synthetic-redirect-token'), false);
  assert.equal(assertNoForbiddenPatterns([websocket, sse, preflight, redirect]), true);
  assert.equal(assertNoNetworkCaptureSiteSemanticClassification(websocket), true);
  assert.equal(assertNoNetworkCaptureSiteSemanticClassification(sse), true);
  assert.equal(assertNoNetworkCaptureSiteSemanticClassification(preflight), true);
  assert.equal(assertNoNetworkCaptureSiteSemanticClassification(redirect), true);
});

test('Browser network tracker exposes bounded redacted observed request lists', () => {
  const client = createFakeCdpClient();
  const tracker = createNetworkTracker(client, 'session-1', {
    maxObservedRequests: 2,
  });
  const session = new BrowserSession({
    client,
    sessionId: 'session-1',
    targetId: 'target-1',
    networkTracker: tracker,
  });

  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-request-1',
      request: {
        method: 'GET',
        url: 'https://example.invalid/api/one?access_token=synthetic-network-one-token',
        headers: {
          authorization: 'Bearer synthetic-network-one-token',
        },
      },
    },
  }));
  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-request-2',
      request: {
        method: 'GET',
        url: 'https://example.invalid/api/two?access_token=synthetic-network-two-token',
        headers: {
          authorization: 'Bearer synthetic-network-two-token',
        },
      },
    },
  }));
  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-request-3',
      request: {
        method: 'GET',
        url: 'https://example.invalid/api/three?access_token=synthetic-network-three-token',
        headers: {
          authorization: 'Bearer synthetic-network-three-token',
        },
      },
    },
  }));

  const observed = session.getObservedNetworkRequests({ siteKey: 'example' });
  assert.equal(observed.length, 2);
  assert.equal(observed[0].id, 'synthetic-request-2');
  assert.equal(observed[1].id, 'synthetic-request-3');
  assert.equal(observed[0].siteKey, 'example');
  assert.equal(observed[0].headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(observed[0].url.includes('synthetic-network-two-token'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-one-token'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-two-token'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-network-three-token'), false);
  assert.equal(session.getObservedNetworkRequests({ siteKey: 'example', limit: 1 }).length, 1);
  assert.deepEqual(session.getObservedNetworkRequests({ siteKey: 'example', limit: 0 }), []);
  assert.deepEqual(session.getObservedNetworkRequests({ siteKey: 'example', limit: -1 }), []);
  assert.deepEqual(session.getObservedNetworkRequests({ siteKey: 'example', limit: 'not-a-number' }), []);
  assert.throws(
    () => session.getObservedNetworkRequests(),
    /siteKey is required/u,
  );

  tracker.clearObservedRequests();
  assert.deepEqual(session.getObservedNetworkRequests({ siteKey: 'example' }), []);
  tracker.dispose();
  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-request-after-dispose',
      request: {
        method: 'GET',
        url: 'https://example.invalid/api/after?access_token=synthetic-after-dispose-token',
        headers: {
          authorization: 'Bearer synthetic-after-dispose-token',
        },
      },
    },
  }));
  assert.deepEqual(session.getObservedNetworkRequests({ siteKey: 'example' }), []);
});

test('Browser network tracker exposes bounded in-memory response summaries without raw body persistence', () => {
  const client = createFakeCdpClient();
  const tracker = createNetworkTracker(client, 'session-1', {
    maxObservedRequests: 4,
    maxObservedResponseSummaries: 2,
  });
  const session = new BrowserSession({
    client,
    sessionId: 'session-1',
    targetId: 'target-1',
    networkTracker: tracker,
  });

  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-response-without-request',
    },
  }));

  for (const requestId of ['synthetic-request-1', 'synthetic-request-2', 'synthetic-request-3', 'synthetic-request-4']) {
    client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
      params: {
        requestId,
        request: {
          method: 'GET',
          url: `https://example.invalid/api/${requestId}?access_token=synthetic-runtime-token`,
          headers: {
            authorization: `Bearer ${requestId}`,
          },
        },
      },
    }));
  }

  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-request-1',
    },
  }));
  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-request-2',
      body: {
        access_token: 'synthetic-response-body-token',
      },
    },
  }));
  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-request-3',
    },
  }));
  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-request-4',
      response: {
        status: 200,
        mimeType: 'application/json',
        headers: {
          authorization: 'Bearer synthetic-response-header-token',
        },
      },
    },
  }));

  const summaries = session.getObservedNetworkResponseSummaries({ siteKey: 'example' });
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].candidateId, 'synthetic-request-1');
  assert.equal(summaries[1].candidateId, 'synthetic-request-3');
  assert.equal(summaries[0].siteKey, 'example');
  assert.equal(summaries[0].source, 'cdp.Network.responseReceived');
  assert.equal(summaries[0].statusCode, 200);
  assert.deepEqual(summaries[0].headerNames, ['cache-control', 'content-type']);
  assert.equal(Object.hasOwn(summaries[0], 'bodyShape'), false);
  assert.equal(Object.hasOwn(summaries[0], 'headers'), false);
  assert.equal(Object.hasOwn(summaries[0], 'endpoint'), false);
  assert.equal(Object.hasOwn(summaries[0], 'catalogEntry'), false);
  assertSchemaCompatible('ApiResponseCaptureSummary', summaries[0]);
  assert.equal(JSON.stringify(summaries).includes('synthetic-runtime-token'), false);
  assert.equal(JSON.stringify(summaries).includes('synthetic-response-body-token'), false);
  assert.equal(JSON.stringify(summaries).includes('synthetic-response-header-token'), false);
  assert.equal(session.getObservedNetworkResponseSummaries({ siteKey: 'example', limit: 1 }).length, 1);
  assert.deepEqual(session.getObservedNetworkResponseSummaries({ siteKey: 'example', limit: 0 }), []);
  assert.deepEqual(session.getObservedNetworkResponseSummaries({ siteKey: 'example', limit: -1 }), []);
  assert.throws(
    () => session.getObservedNetworkResponseSummaries(),
    /siteKey is required/u,
  );

  tracker.clearObservedResponseSummaries();
  assert.deepEqual(session.getObservedNetworkResponseSummaries({ siteKey: 'example' }), []);
  tracker.dispose();
  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-request-after-dispose',
    },
  }));
  client.emit('Network.responseReceived', createResponseReceivedEvent({
    params: {
      requestId: 'synthetic-request-after-dispose',
    },
  }));
  assert.deepEqual(session.getObservedNetworkResponseSummaries({ siteKey: 'example' }), []);
});

test('Browser network tracker records SSE without blocking network idle', async () => {
  const client = createFakeCdpClient();
  const tracker = createNetworkTracker(client, 'session-1', {
    maxObservedRequests: 4,
  });
  const session = new BrowserSession({
    client,
    sessionId: 'session-1',
    targetId: 'target-1',
    networkTracker: tracker,
  });

  client.emit('Network.requestWillBeSent', createRequestWillBeSentEvent({
    params: {
      requestId: 'synthetic-eventsource-request',
      type: 'EventSource',
      request: {
        method: 'GET',
        url: 'https://example.invalid/events?session_id=synthetic-sse-session',
        headers: {
          authorization: 'Bearer synthetic-sse-token',
        },
      },
    },
  }));

  await tracker.waitForIdle({ quietMs: 10, timeoutMs: 500 });
  const observed = session.getObservedNetworkRequests({ siteKey: 'example' });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].transport, 'sse');
  assert.equal(observed[0].headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(JSON.stringify(observed).includes('synthetic-sse-session'), false);
  assert.equal(JSON.stringify(observed).includes('synthetic-sse-token'), false);
  tracker.dispose();
});

test('BrowserSession extracts redacted page resource API hints as observed requests', async () => {
  const session = new BrowserSession({
    client: {
      async send(method) {
        assert.equal(method, 'Runtime.evaluate');
        return {
          result: {
            value: [
              {
                name: 'https://example.invalid/api/hidden-feed?access_token=synthetic-resource-token',
                initiatorType: 'fetch',
              },
              {
                name: 'https://example.invalid/assets/site.css',
                initiatorType: 'link',
              },
            ],
          },
        };
      },
    },
    sessionId: 'synthetic-session',
    targetId: 'synthetic-target',
    networkTracker: null,
  });

  const hints = await session.getObservedPageResourceApiHints({ siteKey: 'example' });

  assert.equal(hints.length, 1);
  assert.equal(hints[0].source, 'browser.performance.resource');
  assert.equal(hints[0].siteKey, 'example');
  assert.equal(hints[0].resourceType, 'Fetch');
  assert.equal(hints[0].url.includes('synthetic-resource-token'), false);
  assert.equal(JSON.stringify(hints).includes('synthetic-resource-token'), false);
  assert.equal(assertNoForbiddenPatterns(hints), true);
});

test('NetworkCapture request lists feed ApiDiscovery without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-network-capture-'));
  try {
    const observedRequests = observedRequestsFromNetworkCaptureEvents([
      createRequestWillBeSentEvent(),
    ], {
      siteKey: 'example',
      observedAt: '2026-05-01T00:00:01.000Z',
    });
    const candidatesDir = path.join(workspace, 'api-candidates');
    const auditsDir = path.join(workspace, 'redaction-audits');

    const results = await writeApiCandidateArtifactsFromObservedRequests(observedRequests, {
      outputDir: candidatesDir,
      redactionAuditDir: auditsDir,
    });

    assert.equal(results.length, 1);
    const candidateText = await readFile(results[0].artifactPath, 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'example');
    assert.equal(candidate.source, 'cdp.Network.requestWillBeSent');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(candidate, 'candidateId'), false);
    assert.equal(Object.hasOwn(candidate, 'version'), false);
    assert.equal(candidateText.includes('synthetic-network-token'), false);
    assert.equal(candidateText.includes('synthetic-network-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-network-csrf'), false);
    const auditText = await readFile(results[0].redactionAuditPath, 'utf8');
    assert.equal(auditText.includes('synthetic-network-token'), false);
    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('NetworkCapture normalizes synthetic CDP response events into bounded response summaries', () => {
  const summary = responseSummaryFromNetworkCaptureEvent(createResponseReceivedEvent({
    params: {
      body: {
        items: [{
          id: 'synthetic-item-id',
          title: 'Synthetic title',
        }],
        ...Object.fromEntries(Array.from({ length: 25 }, (_, index) => [
          `extra-${index}-${'x'.repeat(200)}`,
          `value-${index}`,
        ])),
      },
    },
  }), {
    candidate: createCandidate(),
    capturedAt: '2026-05-02T04:21:00.000Z',
  });

  assert.equal(assertSchemaCompatible('ApiResponseCaptureSummary', summary), true);
  assert.equal(summary.redactionRequired, true);
  assert.equal(summary.candidateId, 'synthetic-response-candidate');
  assert.equal(summary.siteKey, 'example');
  assert.equal(summary.source, 'cdp.Network.responseReceived');
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.contentType, 'application/json');
  assert.deepEqual(summary.headerNames, ['cache-control', 'content-type']);
  assert.equal(summary.bodyShape.type, 'object');
  assert.equal(Object.keys(summary.bodyShape.fields).length, 20);
  assert.equal(Object.keys(summary.bodyShape.fields).every((field) => field.length <= 120), true);
  assert.equal(summary.bodyShape.fieldCount, 26);
  assert.equal(summary.bodyShape.fieldsTruncated, true);
  assert.match(summary.responseSchemaHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(summary.metadata.requestId, 'synthetic-request-1');
  assert.equal(summary.metadata.resourceType, 'XHR');
  assert.equal(summary.metadata.mimeType, 'application/json');
  assert.equal(JSON.stringify(summary).includes('Synthetic title'), false);
  assert.equal(JSON.stringify(summary).includes('synthetic-item-id'), false);
  assert.equal(JSON.stringify(summary).includes('synthetic-response-candidate-token'), false);
  assert.equal(JSON.stringify(summary).includes('"endpoint"'), false);
  assert.equal(JSON.stringify(summary).includes('"headers"'), false);
  assert.equal(Object.hasOwn(summary, 'catalogEntry'), false);
  assert.equal(Object.hasOwn(summary, 'catalogPath'), false);
});

test('NetworkCapture response summaries fail closed for unsafe synthetic response events', () => {
  assert.throws(
    () => responseSummaryFromNetworkCaptureEvent(createRequestWillBeSentEvent(), {
      candidate: createCandidate(),
    }),
    /Unsupported network capture response event/u,
  );
  assert.throws(
    () => responseSummaryFromNetworkCaptureEvent({
      params: {
        response: {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      },
    }, {
      candidate: createCandidate(),
    }),
    /Unsupported network capture response event/u,
  );
  assert.throws(
    () => responseSummaryFromNetworkCaptureEvent(createResponseReceivedEvent({
      params: {
        response: {
          status: 200,
          headers: {
            authorization: 'Bearer synthetic-response-token',
          },
        },
      },
    }), {
      candidate: createCandidate(),
    }),
    /headers must not contain sensitive material/u,
  );
  assert.throws(
    () => responseSummaryFromNetworkCaptureEvent(createResponseReceivedEvent({
      params: {
        body: {
          access_token: 'synthetic-response-token',
        },
      },
    }), {
      candidate: createCandidate(),
    }),
    /body must not contain sensitive material/u,
  );
  assert.throws(
    () => responseSummaryFromNetworkCaptureEvent(createResponseReceivedEvent({
      params: {
        response: {
          headers: {},
        },
      },
    }), {
      candidate: createCandidate(),
    }),
    /statusCode must be an HTTP status code/u,
  );
  assert.throws(
    () => responseSummariesFromNetworkCaptureEvents('not-an-array', {
      candidate: createCandidate(),
    }),
    /response events must be an array/u,
  );
});

test('NetworkCapture rejects unsupported event shapes before producing request lists', () => {
  assert.throws(
    () => observedRequestsFromNetworkCaptureEvents('not-an-array', { siteKey: 'example' }),
    /events must be an array/u,
  );
  assert.throws(
    () => observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent(), {}),
    /siteKey is required/u,
  );
  assert.throws(
    () => observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
      method: 'Network.responseReceived',
    }), { siteKey: 'example' }),
    /Unsupported network capture event/u,
  );
  assert.throws(
    () => observedRequestFromNetworkCaptureEvent(createRequestWillBeSentEvent({
      params: {
        request: {
          method: 'GET',
          headers: {},
        },
      },
    }), { siteKey: 'example' }),
    /url is required/u,
  );
});
