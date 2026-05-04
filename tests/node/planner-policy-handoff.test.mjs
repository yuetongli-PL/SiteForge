import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
  createApiCatalogUpgradeDecision,
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
  writeVerifiedApiCatalogUpgradeFixtureArtifacts,
} from '../../src/sites/capability/api-candidates.mjs';
import {
  assertPlannerPolicyHandoffWriterCompatibility,
  assertPlannerPolicyRuntimeHandoffCompatibility,
  createPlannerPolicyHandoff,
  writeCatalogStorePlannerPolicyHandoffArtifact,
  writePlannerPolicyHandoffArtifact,
} from '../../src/sites/capability/planner-policy-handoff.mjs';
import {
  DOWNLOAD_POLICY_SCHEMA_VERSION,
} from '../../src/sites/capability/download-policy.mjs';
import {
  STANDARD_TASK_LIST_SCHEMA_VERSION,
} from '../../src/sites/capability/standard-task-list.mjs';
import { assertGovernedSchemaCompatible } from '../../src/sites/capability/schema-governance.mjs';

function createCatalogEntry(overrides = {}) {
  return {
    schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
    candidateId: 'candidate-synthetic-planner-list',
    siteKey: 'example',
    endpoint: {
      method: 'GET',
      url: 'https://example.test/api/items?access_token=synthetic-planner-token&cursor=1',
    },
    version: 'api-v1',
    auth: {
      required: true,
      scheme: 'session-view',
    },
    pagination: {
      type: 'cursor',
      cursorField: 'nextCursor',
      pageSize: 20,
    },
    risk: {
      level: 'low',
    },
    fieldMapping: {
      items: '$.data.items',
    },
    verifiedAt: '2026-05-02T00:00:00.000Z',
    lastValidatedAt: '2026-05-02T00:01:00.000Z',
    status: 'cataloged',
    invalidationStatus: 'active',
    ...overrides,
  };
}

function createCandidateFromCatalogEntry(catalogEntry = createCatalogEntry(), overrides = {}) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: catalogEntry.candidateId,
    siteKey: catalogEntry.siteKey,
    status: 'verified',
    endpoint: {
      method: catalogEntry.endpoint?.method ?? 'GET',
      url: catalogEntry.endpoint?.url ?? 'https://example.test/api/items?access_token=synthetic-planner-token&cursor=1',
    },
    auth: catalogEntry.auth,
    pagination: catalogEntry.pagination,
    fieldMapping: catalogEntry.fieldMapping,
    risk: catalogEntry.risk,
    ...overrides,
  };
}

function createAllowedCatalogUpgradeDecision(catalogEntry = createCatalogEntry()) {
  const candidate = createCandidateFromCatalogEntry(catalogEntry);
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const policy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'synthetic-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });
  return createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt: '2026-05-02T00:02:00.000Z',
  });
}

function createBlockedCatalogUpgradeDecision(catalogEntry = createCatalogEntry(), status) {
  const candidate = createCandidateFromCatalogEntry(catalogEntry, { status });
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const policy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'synthetic-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });
  return createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision,
    policy,
    decidedAt: '2026-05-02T00:03:00.000Z',
  });
}

test('planner policy handoff converts an active catalog entry into low-permission products', () => {
  const catalogEntry = createCatalogEntry();
  const handoff = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
      kind: 'request',
      cacheKey: 'example:items',
      dedupKey: 'example:items',
    },
    policy: {
      retries: 2,
      retryBackoffMs: 500,
      cache: true,
      dedup: true,
    },
  });

  assert.equal(handoff.siteKey, 'example');
  assert.equal(handoff.taskType, 'archive-items');
  assert.deepEqual(handoff.catalogGate.requirements, {
    candidateStatus: 'verified',
    candidateVerified: true,
    siteAdapterDecision: 'accepted',
    siteAdapterAccepted: true,
    policyAllowsCatalogUpgrade: true,
  });
  assert.equal(handoff.catalogGate.decision, 'allowed');
  assert.equal(handoff.downloadPolicy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(assertGovernedSchemaCompatible('DownloadPolicy', handoff.downloadPolicy), true);
  assert.equal(handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(handoff.downloadPolicy.dryRun, true);
  assert.equal(handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(handoff.downloadPolicy.retries, 2);
  assert.equal(handoff.taskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertGovernedSchemaCompatible('StandardTaskList', handoff.taskList), true);
  assert.equal(handoff.taskList.policyRef, 'download-policy:example:archive-items');
  assert.equal(handoff.taskList.items[0].id, 'task-item-1');
  assert.equal(handoff.taskList.items[0].method, 'GET');
  assert.equal(handoff.taskList.items[0].capability, 'archive-items');
  assert.equal(handoff.taskList.items[0].mode, 'read');
  assert.equal(handoff.taskList.items[0].endpoint.includes('synthetic-planner-token'), false);
  assert.equal(handoff.taskList.items[0].endpoint.includes('access_token='), true);
  assert.deepEqual(handoff.taskList.items[0].pagination, {
    type: 'cursor',
    cursorField: 'nextCursor',
    pageSize: 20,
  });
  assert.deepEqual(handoff.taskList.items[0].retry, {
    retries: 2,
    retryBackoffMs: 500,
  });
  assert.doesNotMatch(JSON.stringify(handoff), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
});

test('planner policy handoff applies SiteHealthExecutionGate before downloader handoff', () => {
  const catalogEntry = createCatalogEntry();
  const healthRecovery = {
    report: {
      siteId: 'example',
      status: 'degraded',
      risks: [{
        type: 'rate-limited',
        affectedCapability: 'post.write',
      }],
      affectedCapabilities: ['post.write'],
      capabilityHealth: [
        { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
        { capability: 'post.write', status: 'healthy', risks: ['rate-limited'], actions: ['switch-to-readonly-mode'] },
      ],
      recommendedActions: ['switch-to-readonly-mode'],
    },
  };

  const allowed = createPlannerPolicyHandoff({
    catalogEntry,
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'profile-read',
      capability: 'profile.read',
      mode: 'read',
    },
    healthRecovery,
  });

  assert.equal(allowed.taskList.items[0].healthGate.allowed, true);
  assert.equal(allowed.taskList.items[0].healthGate.mode, 'readonly');
  assert.equal(allowed.taskList.items[0].healthGate.artifactWriteAllowed, false);

  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry,
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(catalogEntry),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
        id: 'post-write',
        capability: 'post.write',
        mode: 'write',
      },
      healthRecovery,
    }),
    /blocked by SiteHealthExecutionGate: readonly-mode/u,
  );
});

test('planner policy handoff rejects blocked health gates before artifact writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-health-gate-blocked-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
        id: 'post-write',
        capability: 'post.write',
        mode: 'write',
      },
      healthRecovery: {
        report: {
          siteId: 'example',
          status: 'blocked',
          risks: [{
            type: 'login-required',
            affectedCapability: 'post.write',
          }],
          recommendedActions: ['require-user-action', 'safe-stop'],
        },
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    /blocked by SiteHealthExecutionGate/u,
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff uses schema governance facade for catalog and standard products', async () => {
  const source = await readFile(
    new URL('../../src/sites/capability/planner-policy-handoff.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /function assertPlannerPolicyHandoffWriterCompatibility/u);
  assert.match(source, /function assertPlannerPolicyRuntimeHandoffCompatibility/u);
  assert.match(source, /assertPlannerPolicyHandoffWriterCompatibility\(\{/u);
  assert.match(source, /assertPlannerPolicyRuntimeHandoffCompatibility\(handoff\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('ApiCatalogEntry', catalogEntry\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('DownloadPolicy', downloadPolicy\)/u);
  assert.match(source, /assertGovernedSchemaCompatible\('StandardTaskList', taskList\)/u);
  assert.match(source, /assertTrustBoundaryCrossing/u);
  assert.match(source, /from: 'api-catalog'/u);
  assert.match(source, /to: 'downloader'/u);
  assert.match(source, /'redacted', 'minimized', 'permission-checked'/u);
});

test('planner policy handoff explicit writer compatibility gate fails closed', () => {
  const handoff = createPlannerPolicyHandoff({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
  });

  assert.equal(assertPlannerPolicyHandoffWriterCompatibility({
    catalogEntry: createCatalogEntry(),
    downloadPolicy: handoff.downloadPolicy,
    taskList: handoff.taskList,
  }), true);
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: {
        ...handoff.downloadPolicy,
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
      taskList: handoff.taskList,
    }),
    /DownloadPolicy schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: handoff.downloadPolicy,
      taskList: {
        ...handoff.taskList,
        policyRef: 'browser-profile:synthetic-ref',
      },
    }),
    /must not expose raw browser-profile-ref/u,
  );
  assert.throws(
    () => assertPlannerPolicyHandoffWriterCompatibility({
      catalogEntry: createCatalogEntry(),
      downloadPolicy: {
        ...handoff.downloadPolicy,
        storageStateRef: 'storage-state:synthetic-ref',
      },
      taskList: handoff.taskList,
    }),
    /must not expose raw storageStateRef/u,
  );
});

test('planner policy runtime handoff compatibility gate fails closed', () => {
  const handoff = createPlannerPolicyHandoff({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
  });

  assert.equal(assertPlannerPolicyRuntimeHandoffCompatibility(handoff), true);
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      taskList: {
        ...handoff.taskList,
        schemaVersion: STANDARD_TASK_LIST_SCHEMA_VERSION + 1,
      },
    }),
    /StandardTaskList schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      downloadPolicy: {
        ...handoff.downloadPolicy,
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
    }),
    /DownloadPolicy schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      taskList: {
        ...handoff.taskList,
        policyRef: 'raw-session:synthetic-ref',
      },
    }),
    /must not expose raw session-ref/u,
  );
  assert.throws(
    () => assertPlannerPolicyRuntimeHandoffCompatibility({
      ...handoff,
      diagnostic: 'sid=synthetic-runtime-session',
    }),
    /raw sensitive material/u,
  );
});

test('planner policy handoff rejects inactive catalog entries and site mismatches', () => {
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({ status: 'blocked', invalidationStatus: 'blocked' }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /requires a cataloged ApiCatalogEntry/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({ invalidationStatus: 'stale' }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /requires an active ApiCatalogEntry/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { siteKey: 'other-site', taskType: 'archive-items' },
    }),
    /site mismatch/u,
  );
});

test('planner policy catalog gate blocks observed and candidate API knowledge', () => {
  for (const status of ['observed', 'candidate']) {
    const catalogEntry = createCatalogEntry({
      candidateId: `synthetic-${status}-planner-list`,
    });
    const blockedDecision = createBlockedCatalogUpgradeDecision(catalogEntry, status);

    assert.equal(blockedDecision.decision, 'blocked');
    assert.equal(blockedDecision.requirements.candidateStatus, status);
    assert.equal(blockedDecision.requirements.candidateVerified, false);
    assert.throws(
      () => createPlannerPolicyHandoff({
        catalogEntry,
        catalogUpgradeDecision: blockedDecision,
        taskIntent: {
          siteKey: 'example',
          taskType: 'archive-items',
        },
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    assert.throws(
      () => createPlannerPolicyHandoff({
        catalogEntry,
        catalogUpgradeDecision: {
          ...blockedDecision,
          decision: 'allowed',
          canEnterCatalog: true,
          catalogAction: 'catalog',
        },
        taskIntent: {
          siteKey: 'example',
          taskType: 'archive-items',
        },
      }),
      /requires verified ApiCandidate catalog gate/u,
    );
  }
});

test('planner policy handoff rejects raw session, credential, and profile containers', () => {
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({
        auth: {
          authorization: 'Bearer synthetic-planner-token',
        },
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /must not expose raw authorization/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        headers: {
          authorization: 'Bearer synthetic-planner-token',
        },
      },
    }),
    /must not expose raw headers/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      policy: {
        sessionId: 'synthetic-session-id',
      },
    }),
    /must not expose raw sessionId/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        browserProfile: 'synthetic-profile',
      },
    }),
    /must not expose raw browserProfile/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry({
        auth: {
          profileRef: 'browser-profile:synthetic-ref',
        },
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: { taskType: 'archive-items' },
    }),
    /must not expose raw profileRef/u,
  );
  assert.throws(
    () => createPlannerPolicyHandoff({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        cacheKey: 'credential-ref:synthetic-ref',
      },
    }),
    /must not expose raw credential-ref/u,
  );
});

test('planner policy handoff writer persists redacted artifacts without downloader execution', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  const result = await writePlannerPolicyHandoffArtifact({
    catalogEntry: createCatalogEntry(),
    catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
    taskIntent: {
      siteKey: 'example',
      taskType: 'archive-items',
      id: 'task-item-1',
    },
    policy: {
      retries: 1,
    },
  }, {
    handoffPath,
    redactionAuditPath: auditPath,
  });

  assert.equal(result.artifactPath, handoffPath);
  assert.equal(result.redactionAuditPath, auditPath);
  assert.equal(result.handoff.taskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(result.handoff.downloadPolicy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);

  const handoffJson = await readFile(handoffPath, 'utf8');
  const auditJson = await readFile(auditPath, 'utf8');
  assert.doesNotMatch(handoffJson, /synthetic-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  assert.doesNotMatch(auditJson, /synthetic-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  const persisted = JSON.parse(handoffJson);
  assert.equal(persisted.taskList.items[0].endpoint.includes('access_token='), true);
  assert.equal(persisted.downloadPolicy.dryRun, true);
});

test('verified synthetic catalog fixture enters planner policy handoff through policy gate', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-verified-fixture-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const storeDir = path.join(tempDir, 'store');
  const handoffPath = path.join(tempDir, 'planner', 'planner-handoff.json');
  const handoffAuditPath = path.join(tempDir, 'planner', 'planner-handoff.audit.json');
  const candidate = {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'verified-planner-catalog-fixture',
    siteKey: 'verified-planner-site',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://verified-planner.invalid/api/items?access_token=synthetic-verified-planner-token&cursor=1',
    },
    auth: {
      authorization: 'Bearer synthetic-verified-planner-token',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-verified-planner-token',
        accept: 'application/json',
      },
    },
    pagination: {
      type: 'cursor',
      cursorField: 'nextCursor',
      pageSize: 25,
    },
    fieldMapping: {
      items: '$.data.items',
    },
  };
  const siteAdapterDecision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'verified-planner-adapter',
    decision: 'accepted',
  }, { candidate });
  const allowPolicy = normalizeSiteAdapterCatalogUpgradePolicy({
    adapterId: 'verified-planner-adapter',
    allowCatalogUpgrade: true,
  }, { candidate, siteAdapterDecision });

  const store = await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
    candidate,
    siteAdapterDecision,
    policy: allowPolicy,
    decidedAt: '2026-05-03T08:10:00.000Z',
    metadata: {
      version: 'verified-planner-fixture-v1',
      verifiedAt: '2026-05-03T08:11:00.000Z',
      lastValidatedAt: '2026-05-03T08:12:00.000Z',
      auth: {
        required: true,
        scheme: 'session-view',
      },
      pagination: {
        type: 'cursor',
        cursorField: 'nextCursor',
        pageSize: 25,
      },
    },
  }, {
    decisionPath: path.join(storeDir, 'decision.json'),
    decisionRedactionAuditPath: path.join(storeDir, 'decision.redaction-audit.json'),
    catalogPath: path.join(storeDir, 'entry.json'),
    catalogRedactionAuditPath: path.join(storeDir, 'entry.redaction-audit.json'),
  });

  const result = await writeCatalogStorePlannerPolicyHandoffArtifact(store, {
    taskIntent: {
      siteKey: 'verified-planner-site',
      taskType: 'fixture-items',
      id: 'verified-planner-task-1',
    },
    policy: {
      retries: 1,
      retryBackoffMs: 125,
    },
  }, {
    handoffPath,
    redactionAuditPath: handoffAuditPath,
  });

  assert.equal(result.handoff.catalogEntryId, 'verified-planner-catalog-fixture');
  assert.deepEqual(result.handoff.catalogGate.requirements, {
    candidateStatus: 'verified',
    candidateVerified: true,
    siteAdapterDecision: 'accepted',
    siteAdapterAccepted: true,
    policyAllowsCatalogUpgrade: true,
  });
  assert.equal(result.handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(result.handoff.taskList.items[0].pagination.pageSize, 25);
  assert.equal(result.handoff.taskList.items[0].endpoint.includes('synthetic-verified-planner-token'), false);
  for (const filePath of [handoffPath, handoffAuditPath]) {
    const text = await readFile(filePath, 'utf8');
    assert.doesNotMatch(text, /synthetic-verified-planner-token|authorization|cookie|csrf|sessionId|browserProfile/iu);
  }
});

test('planner policy handoff writer consumes catalog store results without downloader execution', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-catalog-store-handoff-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');
  const result = await writeCatalogStorePlannerPolicyHandoffArtifact({
    catalogEntry: {
      entry: createCatalogEntry(),
    },
    upgradeDecision: {
      decision: createAllowedCatalogUpgradeDecision(),
    },
  }, {
    taskIntent: {
      siteKey: 'example',
      taskType: 'catalog-backed-download',
      id: 'catalog-store-task-1',
    },
    policy: {
      retries: 1,
      retryBackoffMs: 250,
    },
  }, {
    handoffPath,
    redactionAuditPath: auditPath,
  });

  assert.equal(result.handoff.catalogEntryId, 'candidate-synthetic-planner-list');
  assert.equal(result.handoff.taskList.items[0].id, 'catalog-store-task-1');
  assert.equal(result.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(result.handoff.downloadPolicy.sessionRequirement, 'required');
  assert.equal(JSON.stringify(result).includes('synthetic-planner-token'), false);
  await assert.rejects(
    writeCatalogStorePlannerPolicyHandoffArtifact({}, {
      taskIntent: { taskType: 'catalog-backed-download' },
    }, {
      handoffPath: path.join(tempDir, 'missing.json'),
      redactionAuditPath: path.join(tempDir, 'missing.audit.json'),
    }),
    /catalog store entry must be an object/u,
  );
});

test('planner policy handoff writer fails closed before partial writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');
  const missingAuditPath = path.join(tempDir, 'missing-audit-handoff.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        siteKey: 'example',
        taskType: 'archive-items',
      },
    }, {
      handoffPath: missingAuditPath,
    }),
    /PlannerPolicyHandoff redactionAuditPath is required/u,
  );
  await assert.rejects(access(missingAuditPath), /ENOENT/u);

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
        headers: {
          authorization: 'Bearer synthetic-planner-token',
        },
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    /must not expose raw headers/u,
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer maps schema compatibility failure to reasonCode', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-schema-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry({
        schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION + 1,
      }),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'schema-version-incompatible');
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'schema-compatibility');
      assert.deepEqual(error.causeSummary, {
        reasonCode: 'schema-version-incompatible',
        message: 'schema compatibility failure',
      });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer fails closed on downstream policy incompatibility before writes', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-policy-schema-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
      policy: {
        schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'schema-version-incompatible');
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'schema-compatibility');
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});

test('planner policy handoff writer maps policy generation failure and writes nothing', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-policy-handoff-policy-generation-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const handoffPath = path.join(tempDir, 'planner-handoff.json');
  const auditPath = path.join(tempDir, 'planner-handoff.audit.json');

  await assert.rejects(
    writePlannerPolicyHandoffArtifact({
      catalogEntry: createCatalogEntry(),
      catalogUpgradeDecision: createAllowedCatalogUpgradeDecision(),
      taskIntent: {
        taskType: 'archive-items',
      },
      policy: {
        retries: -1,
      },
    }, {
      handoffPath,
      redactionAuditPath: auditPath,
    }),
    (error) => {
      assert.equal(error.reasonCode, 'download-policy-generation-failed');
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.degradable, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.failureMode, 'download-policy-generation');
      assert.deepEqual(error.causeSummary, {
        reasonCode: 'download-policy-generation-failed',
        message: 'download policy generation failure',
      });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-planner-token|authorization|cookie|csrf|sessionId/iu);
      return true;
    },
  );
  await assert.rejects(access(handoffPath), /ENOENT/u);
  await assert.rejects(access(auditPath), /ENOENT/u);
});
