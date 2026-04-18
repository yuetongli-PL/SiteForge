import test from 'node:test';
import assert from 'node:assert/strict';

import { parseNaturalLanguageSiteLoginRequest } from '../../lib/site-login-natural.mjs';
import { runNaturalLanguageSiteLogin } from '../../scripts/nl-site-login.mjs';

test('parseNaturalLanguageSiteLoginRequest resolves bilibili aliases and inline credentials', () => {
  const parsed = parseNaturalLanguageSiteLoginRequest('登录 B站，账号 "foo@example.com"，密码 "s3cret"，打开浏览器等我扫码');

  assert.equal(parsed.inputUrl, 'https://www.bilibili.com/');
  assert.equal(parsed.options.loginUsername, 'foo@example.com');
  assert.equal(parsed.options.loginPassword, 's3cret');
  assert.equal(parsed.options.headless, false);
  assert.equal(parsed.options.waitForManualLogin, true);
  assert.equal(parsed.options.reuseLoginState, true);
  assert.equal(parsed.options.autoLogin, true);
  assert.equal(parsed.warnings.length > 0, true);
});

test('parseNaturalLanguageSiteLoginRequest supports bilibili url and no-reuse wording', () => {
  const parsed = parseNaturalLanguageSiteLoginRequest('重新登录 https://www.bilibili.com/ 不要复用登录态 无头');

  assert.equal(parsed.inputUrl, 'https://www.bilibili.com/');
  assert.equal(parsed.options.reuseLoginState, false);
  assert.equal(parsed.options.headless, true);
});

test('runNaturalLanguageSiteLogin forwards parsed options into siteLogin', async () => {
  /** @type {any[]} */
  const calls = [];
  const result = await runNaturalLanguageSiteLogin('登录 哔哩哔哩 账号 foo 密码 bar', {
    outDir: 'C:/tmp/custom-out',
  }, {
    async siteLogin(inputUrl, options) {
      calls.push({ inputUrl, options });
      return {
        auth: {
          status: 'authenticated',
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].inputUrl, 'https://www.bilibili.com/');
  assert.equal(calls[0].options.loginUsername, 'foo');
  assert.equal(calls[0].options.loginPassword, 'bar');
  assert.equal(calls[0].options.outDir, 'C:/tmp/custom-out');
  assert.equal(result.report.auth.status, 'authenticated');
});
