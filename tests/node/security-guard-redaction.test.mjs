import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REDACTION_PLACEHOLDER,
  SECURITY_GUARD_SCHEMA_VERSION,
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
  prepareRedactedArtifactJsonWithAudit,
  redactBody,
  redactError,
  redactHeaders,
  redactUrl,
  redactValue,
  scanForbiddenPatterns,
} from '../../src/sites/capability/security-guard.mjs';

test('redaction helper identifies sensitive field and header names', () => {
  assert.equal(SECURITY_GUARD_SCHEMA_VERSION, 1);
  assert.equal(isSensitiveFieldName('authorization'), true);
  assert.equal(isSensitiveFieldName('x-csrf-token'), true);
  assert.equal(isSensitiveFieldName('refresh_token'), true);
  assert.equal(isSensitiveFieldName('content-type'), false);
});

test('redactValue removes synthetic sensitive fields without changing safe fields', () => {
  const result = redactValue({
    site: 'example.invalid',
    nested: {
      access_token: 'synthetic-access-token-value',
      safeCount: 3,
    },
    sessions: [
      {
        session_id: 'synthetic-session-id-value',
        label: 'synthetic session label',
      },
    ],
  });

  assert.deepEqual(result.value, {
    site: 'example.invalid',
    nested: {
      access_token: REDACTION_PLACEHOLDER,
      safeCount: 3,
    },
    sessions: [
      {
        session_id: REDACTION_PLACEHOLDER,
        label: 'synthetic session label',
      },
    ],
  });
  assert.deepEqual(result.audit.redactedPaths.sort(), [
    'nested.access_token',
    'sessions.0.session_id',
  ]);
  assert.deepEqual(result.audit.redactions, [
    {
      path: 'nested.access_token',
      reason: 'sensitive-field-name',
    },
    {
      path: 'sessions.0.session_id',
      reason: 'sensitive-field-name',
    },
  ]);

  const xiaohongshu = redactUrl(
    'https://www.xiaohongshu.com/explore/note?xsec_token=synthetic-xhs-xsec-token&xsec_source=pc_search',
  );
  assert.equal(
    xiaohongshu.url,
    'https://www.xiaohongshu.com/explore/note?xsec_token=%5BREDACTED%5D&xsec_source=pc_search',
  );
  assert.ok(xiaohongshu.audit.redactedPaths.includes('url.query.xsec_token'));
});

test('redactHeaders removes synthetic credential headers', () => {
  const result = redactHeaders({
    authorization: 'Bearer synthetic-bearer-token',
    cookie: 'synthetic_cookie_name=synthetic_cookie_value',
    accept: 'application/json',
  });

  assert.deepEqual(result.headers, {
    authorization: REDACTION_PLACEHOLDER,
    cookie: REDACTION_PLACEHOLDER,
    accept: 'application/json',
  });
  assert.deepEqual(result.audit.redactedPaths.sort(), [
    'headers.authorization',
    'headers.cookie',
  ]);
});

test('redactUrl removes synthetic query secrets and userinfo', () => {
  const result = redactUrl(
    'https://synthetic-user:synthetic-pass@example.invalid/path?csrf_token=synthetic-csrf&safe=1&refresh_token=synthetic-refresh',
  );

  assert.equal(
    result.url,
    'https://%5BREDACTED%5D:%5BREDACTED%5D@example.invalid/path?csrf_token=%5BREDACTED%5D&safe=1&refresh_token=%5BREDACTED%5D',
  );
  assert.deepEqual(result.audit.redactedPaths.sort(), [
    'url.password',
    'url.query.csrf_token',
    'url.query.refresh_token',
    'url.username',
  ]);
  assert.deepEqual(result.audit.redactions, [
    {
      path: 'url.username',
      reason: 'url-userinfo',
    },
    {
      path: 'url.password',
      reason: 'url-userinfo',
    },
    {
      path: 'url.query.csrf_token',
      reason: 'sensitive-query-param',
    },
    {
      path: 'url.query.refresh_token',
      reason: 'sensitive-query-param',
    },
  ]);
});

test('redactBody handles JSON and text payloads with synthetic secrets', () => {
  const jsonResult = redactBody(JSON.stringify({
    body: {
      SESSDATA: 'synthetic-sessdata-value',
      note: 'safe synthetic note',
    },
  }));
  assert.equal(jsonResult.body, JSON.stringify({
    body: {
      SESSDATA: REDACTION_PLACEHOLDER,
      note: 'safe synthetic note',
    },
  }));

  const textResult = redactBody('Authorization: Bearer synthetic-text-token');
  assert.equal(textResult.body, `Authorization: ${REDACTION_PLACEHOLDER}`);
  assert.deepEqual(textResult.audit.findings, [
    {
      path: 'body',
      pattern: 'authorization-bearer',
    },
  ]);
  assert.deepEqual(textResult.audit.redactions, [
    {
      path: 'body',
      reason: 'forbidden-pattern',
      pattern: 'authorization-bearer',
    },
  ]);
});

test('redactError removes synthetic sensitive values from diagnostic messages', () => {
  const result = redactError({
    name: 'SyntheticError',
    code: 'synthetic-failure',
    message: 'Request failed with access_token=synthetic-access-token-value',
  });

  assert.equal(
    result.error.message,
    `Request failed with ${REDACTION_PLACEHOLDER}`,
  );
  assert.deepEqual(result.audit.findings, [
    {
      path: 'message',
      pattern: 'sensitive-query-assignment',
    },
  ]);
});

test('forbidden pattern scanner supports fail-closed artifact guards', () => {
  assert.deepEqual(scanForbiddenPatterns({
    message: 'SESSDATA=synthetic-sessdata-value',
  }), [
    {
      path: 'message',
      pattern: 'sessdata-assignment',
    },
  ]);
  assert.deepEqual(scanForbiddenPatterns({
    bearer: 'Authorization: Bearer synthetic-bearer-ref',
    refs: [
      'sessionRef=synthetic-session-ref',
      'profileRef=synthetic-profile-ref',
    ],
  }), [
    {
      path: 'bearer',
      pattern: 'authorization-bearer',
    },
    {
      path: 'refs.0',
      pattern: 'session-reference',
    },
    {
      path: 'refs.1',
      pattern: 'profile-reference',
    },
  ]);
  assert.throws(
    () => assertNoForbiddenPatterns({
      message: 'refresh_token=synthetic-refresh-value',
    }),
    /Forbidden sensitive pattern/u,
  );
  assert.equal(assertNoForbiddenPatterns({
    message: `refresh_token=${REDACTION_PLACEHOLDER}`,
  }), true);
});

test('artifact JSON helper prepares a redacted audit sidecar', () => {
  const prepared = prepareRedactedArtifactJsonWithAudit({
    request: {
      url: 'https://example.invalid/path?refresh_token=synthetic-helper-token',
      headers: {
        authorization: 'Bearer synthetic-helper-bearer',
        accept: 'application/json',
      },
    },
  });

  assert.equal(prepared.json.includes('synthetic-helper-token'), false);
  assert.equal(prepared.json.includes('synthetic-helper-bearer'), false);
  assert.equal(prepared.auditJson.includes('synthetic-helper-token'), false);
  assert.equal(prepared.auditJson.includes('synthetic-helper-bearer'), false);
  assert.deepEqual(prepared.audit.redactedPaths, [
    'request.url',
    'request.headers.authorization',
  ]);
  assert.deepEqual(prepared.audit.findings, [{
    path: 'request.url',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(assertNoForbiddenPatterns(prepared.auditJson), true);
});

test('current manifest writers use paired redaction audit serialization', async () => {
  const writerFiles = [
    ['src/pipeline/stages/capture.mjs', 1],
    ['src/pipeline/stages/expand.mjs', 3],
    ['src/sites/sessions/runner.mjs', 2],
    ['src/sites/downloads/runner.mjs', 1],
    ['src/sites/downloads/executor.mjs', 2],
    ['src/sites/downloads/media-executor.mjs', 1],
    ['src/sites/downloads/legacy-executor.mjs', 2],
    ['src/sites/social/actions/router.mjs', 1],
  ];
  const adHocDoubleSerialization = /prepareRedactedArtifactJson\(\s*manifest\s*\)[\s\S]*prepareRedactedArtifactJson\(\s*audit\s*\)/u;

  for (const [relativePath, minimumUses] of writerFiles) {
    const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
    const pairedUses = source.match(/prepareRedactedArtifactJsonWithAudit\(/gu) ?? [];
    assert.equal(
      pairedUses.length >= minimumUses,
      true,
      `${relativePath} should use paired redaction/audit serialization`,
    );
    assert.equal(
      adHocDoubleSerialization.test(source),
      false,
      `${relativePath} should not manually serialize manifest and audit separately`,
    );
  }
});

test('current capability artifact writers use paired redaction audit serialization', async () => {
  const writerFiles = [
    ['src/sites/capability/api-candidates.mjs', 13],
    ['src/sites/capability/api-discovery.mjs', 1],
    ['src/sites/capability/lifecycle-events.mjs', 1],
    ['src/sites/capability/planner-policy-handoff.mjs', 1],
  ];

  for (const [relativePath, minimumUses] of writerFiles) {
    const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
    const pairedUses = source.match(/prepareRedactedArtifactJsonWithAudit\(/gu) ?? [];
    const pairedAuditWrites = source.match(/write\w*\([^)]*auditJson/gsu) ?? [];
    assert.equal(
      pairedUses.length >= minimumUses,
      true,
      `${relativePath} should prepare persistent artifacts through paired redaction/audit serialization`,
    );
    assert.equal(
      pairedAuditWrites.length > 0,
      true,
      `${relativePath} should persist the paired redaction audit sidecar`,
    );
  }
});

test('ApiCatalog catalog writers persist grouped artifact file sets atomically', async () => {
  const source = await readFile(new URL('../../src/sites/capability/api-candidates.mjs', import.meta.url), 'utf8');

  for (const fragment of [
    'async function writeArtifactFileSetAtomically',
    'assertDistinctArtifactTargets',
    'assertTargetIsNotDirectory',
  ]) {
    assert.equal(
      source.includes(fragment),
      true,
      `ApiCatalog grouped artifact helper should include ${fragment}`,
    );
  }

  const sliceSource = (startMarker, endMarker = null) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `source should include ${startMarker}`);
    const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
    assert.notEqual(end, -1, `source should include ${endMarker}`);
    return source.slice(start, end);
  };

  const writerExpectations = [
    {
      name: 'ApiCatalogEntry artifact writer',
      body: sliceSource(
        'export async function writeApiCatalogEntryArtifact',
        'export async function writeVerifiedApiCatalogUpgradeFixtureArtifacts',
      ),
      fragments: [
        'const prepared = prepareRedactedArtifactJsonWithAudit(entry)',
        'prepareRedactedArtifactJsonWithAudit(createApiCatalogVerificationLifecycleEventFromEntry(entry',
        'await writeArtifactFileSetAtomically([',
        '{ filePath: outputPath, text: prepared.json }',
        '{ filePath: auditPath, text: prepared.auditJson }',
        '{ filePath: hasVerificationEventPath, text: verificationPrepared.json }',
        '{ filePath: hasVerificationEventAuditPath, text: verificationPrepared.auditJson }',
        "'ApiCatalogEntry artifact writer'",
      ],
    },
    {
      name: 'ApiCatalog collection writer',
      body: sliceSource(
        'async function writeApiCatalogCollectionObjectArtifact',
        'export async function writeApiCatalogCollectionStatusTransitionArtifact',
      ),
      fragments: [
        'const prepared = prepareRedactedArtifactJsonWithAudit(normalizedCatalog)',
        'prepareRedactedArtifactJsonWithAudit(createApiCatalogCollectionLifecycleEvent(normalizedCatalog',
        'await writeArtifactFileSetAtomically([',
        '{ filePath: outputPath, text: prepared.json }',
        '{ filePath: auditPath, text: prepared.auditJson }',
        '{ filePath: eventPath, text: lifecyclePrepared.json }',
        '{ filePath: eventAuditPath, text: lifecyclePrepared.auditJson }',
        "'ApiCatalog collection writer'",
      ],
    },
    {
      name: 'ApiCatalogIndex artifact writer',
      body: sliceSource('export async function writeApiCatalogIndexArtifact'),
      fragments: [
        'const prepared = prepareRedactedArtifactJsonWithAudit(index)',
        'prepareRedactedArtifactJsonWithAudit(createApiCatalogIndexLifecycleEvent(index',
        'await writeArtifactFileSetAtomically([',
        '{ filePath: outputPath, text: prepared.json }',
        '{ filePath: auditPath, text: prepared.auditJson }',
        '{ filePath: eventPath, text: lifecyclePrepared.json }',
        '{ filePath: eventAuditPath, text: lifecyclePrepared.auditJson }',
        "'ApiCatalogIndex artifact writer'",
      ],
    },
  ];

  for (const { name, body, fragments } of writerExpectations) {
    for (const fragment of fragments) {
      assert.equal(body.includes(fragment), true, `${name} should include ${fragment}`);
    }
    for (const fragment of [
      'await writeFile(outputPath',
      'await writeFile(auditPath',
      'await writeFile(eventPath',
      'await writeFile(eventAuditPath',
    ]) {
      assert.equal(body.includes(fragment), false, `${name} should avoid split artifact writes via ${fragment}`);
    }
  }
});

test('social report writers use paired redaction audit serialization', async () => {
  const source = await readFile(new URL('../../src/sites/social/actions/router.mjs', import.meta.url), 'utf8');
  const helperStart = source.indexOf('function prepareRedactedMarkdownArtifact');
  const externalStart = source.indexOf('export async function writeExternalSocialReportArtifacts');
  const internalStart = source.indexOf('export async function writeInternalSocialReportArtifact');
  const nextStart = source.indexOf('function capabilityHookMatchSummaryForLifecycleEvent', internalStart);

  assert.notEqual(helperStart, -1);
  assert.notEqual(externalStart, -1);
  assert.notEqual(internalStart, -1);
  assert.notEqual(nextStart, -1);

  const markdownHelperSource = source.slice(helperStart, externalStart);
  const externalSource = source.slice(externalStart, internalStart);
  const internalSource = source.slice(internalStart, nextStart);

  for (const fragment of [
    'redactValue(String(markdown ?? \'\'))',
    'assertNoForbiddenPatterns(markdownText)',
    'prepareRedactedArtifactJsonWithAudit(redactedMarkdown.audit)',
    'createSocialArtifactRedactionFailure(error, { artifactKind })',
  ]) {
    assert.equal(
      markdownHelperSource.includes(fragment),
      true,
      `markdown report helper should include ${fragment}`,
    );
  }

  for (const fragment of [
    'preparedJson = prepareRedactedArtifactJsonWithAudit(finalResult)',
    'preparedMarkdown = prepareRedactedMarkdownArtifact(markdown, { artifactKind: \'external-social-report\' })',
    'await writeTextFile(reportPath, preparedJson.json)',
    'await writeTextFile(jsonAuditPath, preparedJson.auditJson)',
    'await writeTextFile(markdownPath, preparedMarkdown.markdownText)',
    'await writeTextFile(markdownAuditPath, preparedMarkdown.auditJson)',
    'createSocialArtifactRedactionFailure(error, { artifactKind: \'external-social-report\' })',
  ]) {
    assert.equal(
      externalSource.includes(fragment),
      true,
      `external social report writer should include ${fragment}`,
    );
  }

  for (const fragment of [
    'const prepared = prepareRedactedMarkdownArtifact(markdown, { artifactKind: \'internal-social-report\' })',
    'await writeTextFile(reportPath, prepared.markdownText)',
    'await writeTextFile(auditPath, prepared.auditJson)',
  ]) {
    assert.equal(
      internalSource.includes(fragment),
      true,
      `internal social report writer should include ${fragment}`,
    );
  }
});

test('site report writers use paired JSON and Markdown redaction audit serialization', async () => {
  const writerFiles = [
    {
      relativePath: 'src/entrypoints/sites/site-login.mjs',
      prepareFunction: 'prepareSiteLoginReportArtifacts',
      writeFunction: 'writeSiteLoginReportArtifacts',
      profileRedactor: 'redactSiteLoginProfileRefs',
    },
    {
      relativePath: 'src/entrypoints/sites/site-doctor.mjs',
      prepareFunction: 'prepareSiteDoctorReportArtifacts',
      writeFunction: 'writeSiteDoctorReportArtifacts',
      profileRedactor: 'redactSiteDoctorProfileRefs',
    },
    {
      relativePath: 'src/entrypoints/sites/site-scaffold.mjs',
      prepareFunction: 'prepareSiteScaffoldReportArtifacts',
      writeFunction: 'writeSiteScaffoldReportArtifacts',
      profileRedactor: 'redactSiteScaffoldProfileRefs',
    },
    {
      relativePath: 'src/sites/bilibili/navigation/open.mjs',
      prepareFunction: 'prepareBilibiliOpenReportArtifacts',
      writeFunction: 'writeBilibiliOpenReport',
      profileRedactor: 'redactBilibiliOpenProfileRefs',
    },
  ];

  for (const {
    relativePath,
    prepareFunction,
    writeFunction,
    profileRedactor,
  } of writerFiles) {
    const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
    const prepareStart = source.indexOf(`export function ${prepareFunction}`);
    const writeStart = source.indexOf(`export async function ${writeFunction}`);
    const writeEnd = source.indexOf('\n}\n', writeStart);

    assert.notEqual(prepareStart, -1, `${relativePath} should export ${prepareFunction}`);
    assert.notEqual(writeStart, -1, `${relativePath} should export ${writeFunction}`);
    assert.notEqual(writeEnd, -1, `${relativePath} should end ${writeFunction}`);

    const prepareSource = source.slice(prepareStart, writeStart);
    const writeSource = source.slice(writeStart, writeEnd);

    for (const fragment of [
      `const profileRedacted = ${profileRedactor}`,
      'prepareRedactedArtifactJsonWithAudit(profileRedacted.value)',
      'redactValue(String(markdown ?? \'\'))',
      'assertNoForbiddenPatterns(markdownText)',
      'mergeRedactionAudits(profileRedacted.audit, preparedJson.auditValue)',
      'mergeRedactionAudits(profileRedacted.audit, redactedMarkdown.audit)',
      'prepareRedactedArtifactJson(jsonAudit).json',
      'prepareRedactedArtifactJson(markdownAudit).json',
    ]) {
      assert.equal(
        prepareSource.includes(fragment),
        true,
        `${relativePath} prepare path should include ${fragment}`,
      );
    }

    for (const fragment of [
      `const prepared = ${prepareFunction}`,
      'await writeTextFile(jsonPath, prepared.json)',
      'await writeTextFile(jsonAuditPath, prepared.jsonAudit)',
      'await writeTextFile(markdownPath, prepared.markdown)',
      'await writeTextFile(markdownAuditPath, prepared.markdownAudit)',
    ]) {
      assert.equal(
        writeSource.includes(fragment),
        true,
        `${relativePath} writer should include ${fragment}`,
      );
    }
  }
});
