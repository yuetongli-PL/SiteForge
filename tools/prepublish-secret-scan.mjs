// @ts-check

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SENSITIVE_PATTERNS = [
  ['authorization-header', /Authorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/iu],
  ['cookie-header', /\b(?:Cookie|Set-Cookie)\s*:\s*[^;\r\n]+=[^;\r\n]+/iu],
  ['sessdata', /\bSESSDATA\s*[=:]\s*[^&\s"']+/iu],
  ['csrf-token', /\bcsrf(?:Token|_token|-token)?\s*[=:]\s*['"][^'"]{6,}['"]|\bcsrf_token=[^&\s"']+/iu],
  ['access-token', /\baccess[_-]?token\s*[=:]\s*['"][^'"]{8,}['"]|\baccess_token=[^&\s"']+/iu],
  ['refresh-token', /\brefresh[_-]?token\s*[=:]\s*['"][^'"]{8,}['"]|\brefresh_token=[^&\s"']+/iu],
  ['session-id', /\bsession(?:id|_id|-id)\s*[=:]\s*['"][^'"]{8,}['"]|\bsessionid=[^&\s"']+/iu],
  ['browser-profile-path', /\b(?:profilePath|browserProfileRoot|userDataDir)\s*[=:]\s*['"][A-Za-z]:[\\/][^'"]+['"]/iu],
];

const ALLOWED_SYNTHETIC_PATTERNS = [
  /synthetic/iu,
  /\[REDACTED\]/u,
  /REDACTION_PLACEHOLDER/u,
  /prepublish-secret-scan\.mjs/u,
  /SECURITY\.md/u,
  /CONTRIBUTING\.md/u,
  /Select-String -Pattern/u,
  /assert\.doesNotMatch/u,
  /Authorization\|Cookie/u,
  /pattern:/u,
];

function gitFiles() {
  const output = execFileSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ], { encoding: 'utf8' });
  return output.split(/\r?\n/u).filter(Boolean);
}

function isProbablyBinary(buffer) {
  return buffer.includes(0);
}

function isAllowedLine(line, filePath) {
  if (ALLOWED_SYNTHETIC_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }
  if (/^tests[\\/]/u.test(filePath)) {
    return /SECRET|secret|example|private|profiles|fixture|session=1|session-|browser-cookie|video-cookie|stale-cookie|abc123|xyz789|QIDIAN_PROFILE_PATH|PROFILE_PATH|os\.tmpdir|path\.(?:join|resolve)|workspace|null|undefined/iu.test(line);
  }
  return false;
}

const findings = [];

for (const filePath of gitFiles()) {
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    continue;
  }
  if (isProbablyBinary(buffer)) {
    continue;
  }
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (isAllowedLine(line, filePath)) {
      return;
    }
    for (const [label, pattern] of SENSITIVE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          label,
          line: line.trim().slice(0, 180),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Potential sensitive material found before publish:');
  for (const finding of findings) {
    console.error(`${finding.filePath}:${finding.lineNumber} [${finding.label}] ${finding.line}`);
  }
  process.exit(1);
}

console.log(`prepublish-secret-scan passed: scanned ${gitFiles().length} candidate files.`);
