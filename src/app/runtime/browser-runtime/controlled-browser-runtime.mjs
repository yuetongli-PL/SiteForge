// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  BROWSER_RUNTIME_REASONS,
} from './browser-runtime-errors.mjs';
import {
  runControlledBrowserDriver,
} from './browser-runtime-driver.mjs';
import {
  SANITIZED_SUMMARY_ONLY,
  assertSafeBrowserRuntimeSummary,
  safeRuntimeRef,
  sanitizeBrowserRuntimeError,
} from './browser-runtime-sanitizer.mjs';
import {
  createBrowserRuntimeTrace,
} from './browser-runtime-trace.mjs';

const COMPLETION_KINDS = Object.freeze(new Set([
  'selectorVisible',
  'selectorTextEquals',
  'urlMatchesSafePattern',
]));

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value ?? '')).origin;
  } catch {
    return '';
  }
}

function actionDescriptor(contract = {}) {
  return contract.browserActionDescriptor
    ?? contract.runtimeBinding?.browserActionDescriptor
    ?? contract.actionDescriptor
    ?? contract.payloadTemplate?.browserActionDescriptor
    ?? null;
}

function stepTemplates(contract = {}) {
  return asArray(contract.payloadTemplate?.steps).filter(isPlainObject);
}

function firstConcreteStep(contract = {}) {
  return stepTemplates(contract).find((step) => (
    normalizeText(step.selector)
    || normalizeText(step.targetSelector)
    || normalizeText(step.actionRef)
    || normalizeText(step.routeRef)
    || normalizeText(step.nodeId)
  )) ?? null;
}

function runtimeSlotValues(runtimeContext = null) {
  const values = runtimeContext?.slotValues ?? runtimeContext?.fixtureSlotValues ?? null;
  return isPlainObject(values) ? values : {};
}

function slotBindings(payloadTemplate = null) {
  return asArray(payloadTemplate?.slotBindings)
    .filter((slot) => isPlainObject(slot) && normalizeText(slot.name));
}

function bindingMapFromTemplate(payloadTemplate = null) {
  const bindings = {};
  for (const slot of slotBindings(payloadTemplate)) {
    const name = normalizeText(slot.name);
    bindings[name] = normalizeText(slot.binding ?? slot.source ?? slot.path, `payload.${name}`);
  }
  return bindings;
}

function fieldSelectorsFromContract(contract = {}, descriptor = null) {
  const selectors = {
    ...(isPlainObject(contract.selectors?.fields) ? contract.selectors.fields : {}),
    ...(isPlainObject(contract.payloadTemplate?.selectors?.fields) ? contract.payloadTemplate.selectors.fields : {}),
    ...(isPlainObject(descriptor?.selectors?.fields) ? descriptor.selectors.fields : {}),
    ...(isPlainObject(descriptor?.fieldSelectors) ? descriptor.fieldSelectors : {}),
  };
  for (const slot of slotBindings(contract.payloadTemplate)) {
    const selector = normalizeText(slot.selector ?? slot.fieldSelector);
    if (selector) {
      selectors[normalizeText(slot.name)] = selector;
    }
  }
  return Object.fromEntries(Object.entries(selectors)
    .map(([key, value]) => [normalizeText(key), normalizeText(value)])
    .filter(([key, value]) => key && value));
}

function completionSignalFromContract(contract = {}, descriptor = null) {
  const signal = descriptor?.completionSignal
    ?? contract.completionSignal
    ?? contract.payloadTemplate?.completionSignal
    ?? null;
  if (!isPlainObject(signal)) {
    return null;
  }
  const kind = normalizeText(signal.kind);
  if (!COMPLETION_KINDS.has(kind)) {
    return null;
  }
  if ((kind === 'selectorVisible' || kind === 'selectorTextEquals') && !normalizeText(signal.selector)) {
    return null;
  }
  if (kind === 'selectorTextEquals' && !normalizeText(signal.text)) {
    return null;
  }
  if (kind === 'urlMatchesSafePattern' && !normalizeText(signal.pattern)) {
    return null;
  }
  return {
    kind,
    selector: normalizeText(signal.selector) || undefined,
    text: normalizeText(signal.text) || undefined,
    pattern: normalizeText(signal.pattern) || undefined,
    timeoutMs: Math.max(1, Number(signal.timeoutMs) || 3_000),
  };
}

export function normalizeBrowserActionContract({
  executionContract = null,
  runtimeContext = null,
} = {}) {
  const contract = isPlainObject(executionContract) ? executionContract : {};
  const descriptor = actionDescriptor(contract);
  const step = firstConcreteStep(contract);
  const payloadTemplate = isPlainObject(contract.payloadTemplate) ? contract.payloadTemplate : null;
  const bindings = bindingMapFromTemplate(payloadTemplate);
  const fieldSelectors = fieldSelectorsFromContract(contract, descriptor);
  const requiredSlots = (
    asArray(descriptor?.requiredSlots).map((slot) => normalizeText(slot)).filter(Boolean).length
      ? asArray(descriptor?.requiredSlots).map((slot) => normalizeText(slot)).filter(Boolean)
      : slotBindings(payloadTemplate).filter((slot) => slot.required === true).map((slot) => normalizeText(slot.name))
  );
  const submitSelector = normalizeText(
    descriptor?.selectors?.submit
      ?? descriptor?.submitSelector
      ?? descriptor?.selector
      ?? descriptor?.targetSelector
      ?? contract.selectors?.submit
      ?? contract.payloadTemplate?.selectors?.submit
      ?? step?.submitSelector
      ?? step?.selector
      ?? step?.targetSelector,
  );
  const actionRef = normalizeText(
    descriptor?.actionRef
      ?? descriptor?.actionId
      ?? step?.actionRef
      ?? step?.action
      ?? step?.nodeId,
  );
  const routeRef = normalizeText(
    descriptor?.routeRef
      ?? descriptor?.routeId
      ?? step?.routeRef
      ?? step?.routeTemplate
      ?? step?.routePath,
  );
  const values = runtimeSlotValues(runtimeContext);
  const completionSignal = completionSignalFromContract(contract, descriptor);

  if (!submitSelector || (!actionRef && !routeRef) || !payloadTemplate || !Array.isArray(payloadTemplate.slotBindings)) {
    return { concrete: false, reasonCode: 'runtime.contract_not_concrete_enough' };
  }
  if (requiredSlots.length === 0 || !completionSignal) {
    return { concrete: false, reasonCode: 'runtime.contract_not_concrete_enough' };
  }
  for (const slotName of requiredSlots) {
    if (!normalizeText(fieldSelectors[slotName]) || !normalizeText(bindings[slotName])) {
      return { concrete: false, reasonCode: 'runtime.contract_not_concrete_enough' };
    }
    if (!Object.hasOwn(values, slotName) || values[slotName] === undefined || values[slotName] === null || String(values[slotName]).trim() === '') {
      return { concrete: false, reasonCode: 'runtime.contract_not_concrete_enough' };
    }
  }

  const normalized = {
    concrete: true,
    actionRef: safeRuntimeRef(actionRef),
    routeRef: safeRuntimeRef(routeRef),
    submitSelector,
    fieldSelectors,
    requiredSlots,
    slotBindings: bindings,
    slotNames: requiredSlots,
    completionSignal,
  };
  return normalized;
}

export function validateControlledBrowserRuntimeDescriptor(runtimeContext = null) {
  if (runtimeContext?.controlledBrowserRuntime !== true) {
    return {
      valid: false,
      reasonCode: 'runtime.browser_action_uncontrolled_site',
    };
  }
  const descriptor = runtimeContext?.browserRuntime;
  if (!isPlainObject(descriptor)) {
    return {
      valid: false,
      reasonCode: BROWSER_RUNTIME_REASONS.descriptorMissing,
    };
  }
  const startUrl = normalizeText(descriptor.startUrl);
  const startOrigin = normalizedOrigin(startUrl);
  const allowedOrigins = asArray(descriptor.allowedOrigins)
    .map((origin) => normalizedOrigin(origin) || normalizeText(origin))
    .filter(Boolean);
  const requiredFalse = [
    'persistProfile',
    'recordDom',
    'recordScreenshots',
    'recordVideo',
    'recordFullTrace',
  ];
  if (!startUrl || !startOrigin || allowedOrigins.length === 0 || !allowedOrigins.includes(startOrigin)) {
    return {
      valid: false,
      reasonCode: BROWSER_RUNTIME_REASONS.descriptorMissing,
    };
  }
  for (const flag of ['allowExternalNetwork', 'allowDownloads', 'allowPopups']) {
    if (descriptor[flag] === true) {
      return {
        valid: false,
        reasonCode: BROWSER_RUNTIME_REASONS.descriptorMissing,
      };
    }
  }
  for (const flag of requiredFalse) {
    if (descriptor[flag] !== false) {
      return {
        valid: false,
        reasonCode: BROWSER_RUNTIME_REASONS.descriptorMissing,
      };
    }
  }
  const normalized = {
    mode: 'controlled',
    engine: normalizeText(descriptor.engine, 'chromium'),
    startUrl,
    allowedOrigins: [...new Set(allowedOrigins)],
    allowExternalNetwork: false,
    allowDownloads: false,
    allowPopups: false,
    persistProfile: false,
    recordDom: false,
    recordScreenshots: false,
    recordVideo: false,
    recordFullTrace: false,
    timeoutMs: Math.max(1, Number(descriptor.timeoutMs) || 5_000),
    actionTimeoutMs: Math.max(1, Number(descriptor.actionTimeoutMs) || 3_000),
    completionTimeoutMs: Math.max(1, Number(descriptor.completionTimeoutMs) || 3_000),
  };
  return {
    valid: true,
    descriptor: normalized,
  };
}

/** @param {Record<string, any>} options */
function browserActionResultSummary({
  invocationRequest = null,
  contract,
  trace,
  status,
  reasonCode = null,
} = {}) {
  const summary = {
    outcome: status === 'completed' ? 'browser_action_completed' : 'browser_action_failed',
    providerId: 'browser_action_provider',
    runtimeMode: 'controlled_browser_runtime_v2',
    capabilityId: invocationRequest?.capabilityId ?? null,
    executionContractRef: invocationRequest?.executionContractRef ?? null,
    actionRef: contract.actionRef,
    routeRef: contract.routeRef,
    slotNames: contract.slotNames,
    payloadTemplate: {
      material: 'template_only',
      slotCount: contract.requiredSlots.length,
      requiredSlotCount: contract.requiredSlots.length,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
    },
    browserExecutionTrace: trace.summary({
      status,
      completion: {
        kind: contract.completionSignal.kind,
        status: status === 'completed' ? 'observed' : 'not_observed',
        reasonCode: reasonCode ?? undefined,
      },
    }),
    artifactRefs: [],
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    redactionRequired: true,
  };
  return assertSafeBrowserRuntimeSummary(summary);
}

export async function executeControlledBrowserRuntime({
  invocationRequest = null,
  executionContract = null,
  runtimeContext = null,
  deps = {},
} = {}) {
  const descriptorResult = validateControlledBrowserRuntimeDescriptor(runtimeContext);
  if (descriptorResult.valid !== true) {
    return {
      providerId: 'browser_action_provider',
      providerKind: 'browser_action_provider',
      status: 'provider_not_executable',
      reasonCode: descriptorResult.reasonCode,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: false,
      artifactRefs: [],
      sanitizedError: sanitizeBrowserRuntimeError(descriptorResult.reasonCode),
      resultSummary: null,
    };
  }

  const contract = normalizeBrowserActionContract({ executionContract, runtimeContext });
  if (contract.concrete !== true) {
    return {
      providerId: 'browser_action_provider',
      providerKind: 'browser_action_provider',
      status: 'provider_not_executable',
      reasonCode: contract.reasonCode,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: false,
      artifactRefs: [],
      sanitizedError: sanitizeBrowserRuntimeError(contract.reasonCode),
      resultSummary: null,
    };
  }

  const trace = createBrowserRuntimeTrace({
    actionRef: contract.actionRef,
    routeRef: contract.routeRef,
    slotNames: contract.slotNames,
    startUrl: descriptorResult.descriptor.startUrl,
  });

  let driverResult;
  try {
    driverResult = await runControlledBrowserDriver({
      descriptor: descriptorResult.descriptor,
      contract,
      slotValues: runtimeSlotValues(runtimeContext),
      trace,
      deps,
    });
  } catch {
    driverResult = {
      status: 'failed',
      reasonCode: BROWSER_RUNTIME_REASONS.runtimeUnavailable,
      sideEffectAttempted: false,
    };
  }

  const reasonCode = driverResult.reasonCode ?? null;
  const status = driverResult.status === 'completed' ? 'completed' : 'failed';
  const result = {
    providerId: 'browser_action_provider',
    providerKind: 'browser_action_provider',
    status,
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted: driverResult.sideEffectAttempted === true,
    sideEffectSucceeded: status === 'completed',
    sideEffectFailed: status !== 'completed',
    artifactRefs: [],
    sanitizedError: status === 'completed' ? null : sanitizeBrowserRuntimeError(reasonCode),
    resultSummary: browserActionResultSummary({
      invocationRequest,
      contract,
      trace,
      status,
      reasonCode,
    }),
  };
  assertNoExecutionSensitiveMaterial(result);
  return result;
}
