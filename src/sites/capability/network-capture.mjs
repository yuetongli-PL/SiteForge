// @ts-check

import {
  redactBody,
  redactHeaders,
  redactUrl,
} from './security-guard.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  createApiCandidateResponseCaptureSummary,
} from './api-candidates.mjs';

export const NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION = 'network-capture-request.v1';
export const NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELDS = Object.freeze([
  'apiKind',
  'apiRole',
  'apiType',
  'authStatus',
  'catalogEntry',
  'classification',
  'coreApi',
  'coreApiType',
  'isAuthenticated',
  'isCoreApi',
  'pageKind',
  'pageType',
  'requiresAuth',
  'sitePageType',
  'verified',
  'verification',
  'verificationStatus',
]);

const NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELD_SET = new Set(
  NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELDS,
);

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeCdpRequestEvent(event = {}) {
  const method = normalizeText(event.method ?? event.params?.method);
  if (method && method !== 'Network.requestWillBeSent') {
    throw new Error(`Unsupported network capture event: ${method}`);
  }
  const params = event.params ?? event;
  const request = params.request ?? {};
  return {
    params,
    request,
  };
}

function normalizeCdpResponseEvent(event = {}) {
  const method = normalizeText(event.method ?? event.params?.method);
  if (method !== 'Network.responseReceived') {
    throw new Error(`Unsupported network capture response event: ${method}`);
  }
  const params = event.params ?? event;
  const response = params.response ?? {};
  return {
    params,
    response,
  };
}

function apiCandidateFromObservedRequest(raw = {}) {
  const siteKey = normalizeText(raw.siteKey);
  if (!siteKey) {
    throw new Error('NetworkCapture response summary observed request siteKey is required');
  }
  const endpointUrl = normalizeText(raw.url ?? raw.endpoint?.url);
  if (!endpointUrl) {
    throw new Error('NetworkCapture response summary observed request url is required');
  }
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: normalizeText(raw.id),
    siteKey,
    status: 'observed',
    endpoint: {
      method: normalizeText(raw.method ?? raw.endpoint?.method) ?? 'GET',
      url: endpointUrl,
    },
    source: normalizeText(raw.source) ?? 'network-capture',
    observedAt: normalizeText(raw.observedAt),
    evidence: raw.evidence,
    request: {
      headers: raw.headers ?? raw.request?.headers ?? {},
      body: raw.body ?? raw.request?.body,
    },
  };
}

function compactAudit(...audits) {
  return {
    redactedPaths: audits.flatMap((audit) => Array.isArray(audit?.redactedPaths) ? audit.redactedPaths : []),
    findings: audits.flatMap((audit) => Array.isArray(audit?.findings) ? audit.findings : []),
  };
}

function collectForbiddenSiteSemanticFields(value, path = []) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenSiteSemanticFields(item, [...path, String(index)]));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key];
    const current = NETWORK_CAPTURE_FORBIDDEN_SITE_SEMANTIC_FIELD_SET.has(key)
      ? [childPath.join('.')]
      : [];
    return [
      ...current,
      ...collectForbiddenSiteSemanticFields(child, childPath),
    ];
  });
}

export function assertNoNetworkCaptureSiteSemanticClassification(record) {
  const forbiddenFields = collectForbiddenSiteSemanticFields(record);
  if (forbiddenFields.length > 0) {
    throw new Error(
      `NetworkCapture observed request must not classify site semantics: ${forbiddenFields.join(', ')}`,
    );
  }
  return true;
}

export function observedRequestFromNetworkCaptureEvent(event = {}, {
  siteKey,
  observedAt,
  source = 'cdp.Network.requestWillBeSent',
} = {}) {
  const normalizedSiteKey = normalizeText(siteKey ?? event.siteKey);
  if (!normalizedSiteKey) {
    throw new Error('NetworkCapture observed request siteKey is required');
  }
  const { params, request } = normalizeCdpRequestEvent(event);
  const rawUrl = normalizeText(request.url ?? params.url);
  if (!rawUrl) {
    throw new Error('NetworkCapture observed request url is required');
  }

  const redactedUrl = redactUrl(rawUrl);
  const redactedHeaders = redactHeaders(request.headers ?? {});
  const redactedBody = redactBody(request.postData ?? request.body);
  const redactedDocumentUrl = params.documentURL ? redactUrl(params.documentURL) : null;
  const audit = compactAudit(
    redactedUrl.audit,
    redactedHeaders.audit,
    redactedBody.audit,
    redactedDocumentUrl?.audit,
  );

  const observedRequest = {
    schemaVersion: NETWORK_CAPTURE_REQUEST_SCHEMA_VERSION,
    id: normalizeText(params.requestId),
    siteKey: normalizedSiteKey,
    status: 'observed',
    method: normalizeText(request.method) ?? 'GET',
    url: redactedUrl.url,
    source,
    observedAt: normalizeText(observedAt ?? event.observedAt ?? params.wallTime),
    headers: redactedHeaders.headers,
    body: redactedBody.body,
    evidence: {
      event: 'Network.requestWillBeSent',
      resourceType: normalizeText(params.type),
      documentUrl: redactedDocumentUrl?.url,
      initiatorType: normalizeText(params.initiator?.type),
    },
    redactionAudit: audit,
  };
  assertNoNetworkCaptureSiteSemanticClassification(observedRequest);
  return observedRequest;
}

export function observedRequestsFromNetworkCaptureEvents(events = [], options = {}) {
  if (!Array.isArray(events)) {
    throw new Error('NetworkCapture events must be an array');
  }
  return events.map((event) => observedRequestFromNetworkCaptureEvent(event, options));
}

export function responseSummaryFromNetworkCaptureEvent(event = {}, {
  candidate,
  observedRequest,
  capturedAt,
  source = 'cdp.Network.responseReceived',
} = {}) {
  const { params, response } = normalizeCdpResponseEvent(event);
  const responseCandidate = candidate ?? apiCandidateFromObservedRequest(observedRequest);
  const statusCode = Number(response.status ?? response.statusCode);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error('NetworkCapture response summary statusCode must be an HTTP status code');
  }
  return createApiCandidateResponseCaptureSummary({
    candidate: responseCandidate,
    capturedAt: capturedAt ?? event.capturedAt ?? params.timestamp,
    source,
    response: {
      statusCode,
      headers: response.headers ?? {},
      ...(Object.hasOwn(params, 'body') ? { body: params.body } : {}),
    },
    metadata: {
      requestId: normalizeText(params.requestId),
      resourceType: normalizeText(params.type),
      mimeType: normalizeText(response.mimeType),
    },
  });
}

export function responseSummariesFromNetworkCaptureEvents(events = [], options = {}) {
  if (!Array.isArray(events)) {
    throw new Error('NetworkCapture response events must be an array');
  }
  return events.map((event) => responseSummaryFromNetworkCaptureEvent(event, options));
}
