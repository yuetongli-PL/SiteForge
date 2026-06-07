// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  executeControlledBrowserRuntime,
  normalizeBrowserActionContract,
  validateControlledBrowserRuntimeDescriptor,
} from '../browser-runtime/controlled-browser-runtime.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const BROWSER_ACTION_PROVIDER_ID = 'browser_action_provider';
const WRITE_KINDS = Object.freeze(new Set(['write', 'submit', 'form_or_action', 'browser_bridge']));
const PAYMENT_OR_DESTRUCTIVE_PATTERN =
  /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|charge|refund)\b/iu;
const SANITIZED_SUMMARY_ONLY = 'sanitized_summary_only';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
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

function descriptorKind(descriptor = {}) {
  const kind = inferRuntimeCapabilityKind(descriptor);
  if (kind !== 'generic') {
    return kind;
  }
  for (const value of [
    descriptor.executionContract?.capabilityKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.capability?.capabilityKind,
    descriptor.capability?.operationKind,
    descriptor.runtimeContext?.capabilityKind,
    descriptor.runtimeContext?.operationKind,
    descriptor.runtimeContext?.runtimeBindingKind,
  ]) {
    const direct = normalizeKind(value);
    if (direct) return direct;
  }
  return kind;
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.executionContract?.browserActionDescriptor?.actionRef,
    descriptor.executionContract?.browserActionDescriptor?.routeRef,
    ...asArray(descriptor.executionContract?.payloadTemplate?.steps)
      .flatMap((step) => [step?.actionRef, step?.action, step?.routeRef]),
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
  ].map((value) => String(value ?? '')).join(' ');
}

function isPaymentOrDestructiveDescriptor(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  if (
    contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
  ) {
    return true;
  }
  return PAYMENT_OR_DESTRUCTIVE_PATTERN.test(descriptorText(descriptor));
}

function supportsBrowserAction(descriptor = {}) {
  if (isPaymentOrDestructiveDescriptor(descriptor)) {
    return false;
  }
  const kind = descriptorKind(descriptor);
  if (WRITE_KINDS.has(kind)) {
    return true;
  }
  const operationKind = normalizeKind(descriptor.executionContract?.operationKind);
  const bindingKind = normalizeKind(descriptor.executionContract?.runtimeBinding?.kind);
  return operationKind === 'form_or_action' || bindingKind === 'browser_bridge';
}

function stepTemplates(contract = {}) {
  return asArray(contract.payloadTemplate?.steps)
    .filter(isPlainObject);
}

function actionDescriptor(contract = {}) {
  return contract.browserActionDescriptor
    ?? contract.runtimeBinding?.browserActionDescriptor
    ?? contract.actionDescriptor
    ?? contract.payloadTemplate?.browserActionDescriptor
    ?? null;
}

function firstConcreteStep(contract = {}) {
  return stepTemplates(contract)
    .find((step) => (
      normalizeText(step.selector)
      || normalizeText(step.actionRef)
      || normalizeText(step.routeRef)
      || normalizeText(step.nodeId)
      || normalizeText(step.routeTemplate)
      || normalizeText(step.routePath)
    )) ?? null;
}

function concreteBrowserActionDescriptor(contract = {}) {
  const descriptor = actionDescriptor(contract);
  const step = firstConcreteStep(contract);
  const payloadTemplate = isPlainObject(contract.payloadTemplate) ? contract.payloadTemplate : null;
  const slotBindings = asArray(payloadTemplate?.slotBindings).filter((slot) => normalizeText(slot?.name));
  const requiredSlots = asArray(descriptor?.requiredSlots).map((slot) => normalizeText(slot)).filter(Boolean);
  const payloadRequiredSlots = slotBindings
    .filter((slot) => slot?.required === true)
    .map((slot) => normalizeText(slot.name))
    .filter(Boolean);
  const selector = normalizeText(
    descriptor?.selector
      ?? descriptor?.targetSelector
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
  return {
    selector,
    actionRef,
    routeRef,
    requiredSlots: requiredSlots.length ? requiredSlots : payloadRequiredSlots,
    slotBindings,
    payloadTemplate,
  };
}

function hasExplicitControlledRuntime(runtimeContext = null) {
  return runtimeContext?.localFixture === true
    || runtimeContext?.controlledBrowserRuntime === true;
}

function runtimeSlotValues(runtimeContext = null) {
  const values = runtimeContext?.slotValues ?? runtimeContext?.fixtureSlotValues ?? null;
  return isPlainObject(values) ? values : {};
}

function hasRuntimeSlotValue(values, slotName) {
  return Object.hasOwn(values, slotName)
    && values[slotName] !== undefined
    && values[slotName] !== null
    && String(values[slotName]).trim() !== '';
}

function concreteEnough(options = {}) {
  const contract = options.executionContract ?? {};
  const descriptor = concreteBrowserActionDescriptor(contract);
  if (!descriptor.selector) {
    return false;
  }
  if (!descriptor.actionRef && !descriptor.routeRef) {
    return false;
  }
  if (!isPlainObject(descriptor.payloadTemplate)) {
    return false;
  }
  if (!Array.isArray(descriptor.payloadTemplate.slotBindings)) {
    return false;
  }
  const bindingNames = new Set(descriptor.slotBindings.map((slot) => normalizeText(slot.name)).filter(Boolean));
  for (const slotName of descriptor.requiredSlots) {
    if (!bindingNames.has(slotName)) {
      return false;
    }
    if (!hasRuntimeSlotValue(runtimeSlotValues(options.runtimeContext), slotName)) {
      return false;
    }
  }
  return true;
}

function safeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function buildBrowserActionSummary(options = {}) {
  const contract = options.executionContract ?? {};
  const descriptor = concreteBrowserActionDescriptor(contract);
  const summary = {
    outcome: 'browser_action_completed',
    providerId: BROWSER_ACTION_PROVIDER_ID,
    runtimeMode: 'controlled_fixture_browser_action',
    capabilityId: options.invocationRequest?.capabilityId ?? contract.capabilityId ?? null,
    executionContractRef: options.invocationRequest?.executionContractRef ?? contract.executionContractRef ?? contract.id ?? null,
    actionRef: safeRef(descriptor.actionRef),
    routeRef: safeRef(descriptor.routeRef),
    slotNames: descriptor.requiredSlots.map((slot) => normalizeText(slot)).filter(Boolean),
    payloadTemplate: {
      material: 'template_only',
      slotCount: descriptor.slotBindings.length,
      requiredSlotCount: descriptor.requiredSlots.length,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
    },
    artifactRefs: [],
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(summary);
  return summary;
}

async function runControlledBrowserAction(options = {}) {
  if (options.executionContract?.authRequirement?.required === true && options.authAdapter?.isRequired?.() !== true) {
    return {
      providerId: BROWSER_ACTION_PROVIDER_ID,
      providerKind: 'browser_action_provider',
      status: 'failed',
      reasonCode: 'runtime.auth_required',
      runtimeExecuted: true,
      sideEffectAttempted: false,
      sideEffectSucceeded: false,
      sideEffectFailed: true,
      artifactRefs: [],
      resultSummary: {
        outcome: 'browser_action_failed',
        providerId: BROWSER_ACTION_PROVIDER_ID,
        reasonCode: 'runtime.auth_required',
        artifactRefs: [],
        savedMaterial: SANITIZED_SUMMARY_ONLY,
        redactionRequired: true,
      },
    };
  }
  if (options.runtimeContext?.controlledBrowserRuntime === true) {
    return await executeControlledBrowserRuntime({
      invocationRequest: options.invocationRequest,
      executionContract: options.executionContract,
      runtimeContext: options.runtimeContext,
      authAdapter: options.authAdapter,
      deps: options.browserRuntimeDeps,
    });
  }

  return {
    providerId: BROWSER_ACTION_PROVIDER_ID,
    providerKind: 'browser_action_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    artifactRefs: [],
    resultSummary: buildBrowserActionSummary(options),
  };
}

export function createBrowserActionProvider(factoryOptions = {}) {
  const browserRuntimeDeps = factoryOptions.browserRuntimeDeps ?? {};
  return {
    id: BROWSER_ACTION_PROVIDER_ID,
    providerKind: 'browser_action_provider',
    capabilityKinds: ['write', 'submit'],
    supports(descriptor = {}) {
      return supportsBrowserAction(descriptor);
    },
    canExecute(options = {}) {
      if (!supportsBrowserAction(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.browser_action_provider_unsupported',
        };
      }
      if (!hasExplicitControlledRuntime(options.runtimeContext)) {
        return {
          allowed: false,
          reasonCode: 'runtime.browser_action_uncontrolled_site',
        };
      }
      if (!concreteEnough(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.contract_not_concrete_enough',
        };
      }
      if (options.runtimeContext?.controlledBrowserRuntime === true) {
        const contract = normalizeBrowserActionContract({
          executionContract: options.executionContract,
          runtimeContext: options.runtimeContext,
        });
        if (contract.concrete !== true) {
          return {
            allowed: false,
            reasonCode: 'runtime.contract_not_concrete_enough',
          };
        }
        const descriptor = validateControlledBrowserRuntimeDescriptor(options.runtimeContext);
        if (descriptor.valid !== true) {
          return {
            allowed: false,
            reasonCode: descriptor.reasonCode,
          };
        }
      }
      return { allowed: true };
    },
    async run(options = {}) {
      return runControlledBrowserAction({
        ...options,
        browserRuntimeDeps,
      });
    },
  };
}

export { BROWSER_ACTION_PROVIDER_ID };
