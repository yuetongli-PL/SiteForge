// @ts-check

const BILIBILI_URL = 'https://www.bilibili.com/';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function extractQuotedOrBare(text, labels) {
  const joined = labels.join('|');
  const quoted = new RegExp(`(?:${joined})\\s*(?:是|为|=|:|：)?\\s*["“'']([^"”'']+)["”'']`, 'i');
  const quotedMatch = text.match(quoted);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }
  const bare = new RegExp(`(?:${joined})\\s*(?:是|为|=|:|：)?\\s*([^\\s，。；,;]+)`, 'i');
  const bareMatch = text.match(bare);
  return bareMatch?.[1]?.trim() || null;
}

function resolveInputUrl(text) {
  const urlMatch = text.match(/https?:\/\/[^\s"”'']+/i);
  if (urlMatch?.[0]) {
    return urlMatch[0];
  }
  if (/(?:bilibili|b站|哔哩哔哩)/i.test(text)) {
    return BILIBILI_URL;
  }
  return null;
}

function inferBoolean(text, positivePatterns, negativePatterns, fallback) {
  if (negativePatterns.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (positivePatterns.some((pattern) => pattern.test(text))) {
    return true;
  }
  return fallback;
}

function parseManualTimeoutMs(text) {
  const match = text.match(/(?:等待|超时|最多等|最多等待)\s*(\d+)\s*(秒|分钟|min|mins|minute|minutes|s)\b/i);
  if (!match) {
    return undefined;
  }
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) {
    return undefined;
  }
  const unit = match[2].toLowerCase();
  if (unit === '分钟' || unit.startsWith('min') || unit.startsWith('minute')) {
    return count * 60_000;
  }
  return count * 1_000;
}

export function parseNaturalLanguageSiteLoginRequest(requestText) {
  const text = normalizeText(requestText);
  if (!text) {
    throw new Error('Missing natural-language login request.');
  }

  const inputUrl = resolveInputUrl(text);
  if (!inputUrl) {
    throw new Error('Could not resolve a supported site from the login request. Mention a verified site such as bilibili or include the site URL.');
  }

  const loginUsername = extractQuotedOrBare(text, [
    '账号',
    '账户',
    '帐户',
    '用户名',
    'username',
    'user',
    'account',
  ]) ?? undefined;

  const loginPassword = extractQuotedOrBare(text, [
    '密码',
    'password',
    'passcode',
  ]) ?? undefined;

  const headless = inferBoolean(
    text,
    [/无头/i, /\bheadless\b/i],
    [/可见浏览器/i, /显示浏览器/i, /打开浏览器/i, /手动登录/i, /扫码登录/i, /人工登录/i],
    false,
  );

  const autoLogin = inferBoolean(
    text,
    [/自动登录/i, /自动填充/i, /自动填写/i],
    [/不要自动登录/i, /不要自动填充/i, /仅复用登录态/i, /只复用登录态/i],
    loginUsername || loginPassword ? true : undefined,
  );

  const reuseLoginState = inferBoolean(
    text,
    [/复用登录态/i, /使用已有登录态/i, /沿用登录态/i],
    [/不要复用登录态/i, /不复用登录态/i, /全新登录/i, /重新登录/i],
    true,
  );

  const waitForManualLogin = inferBoolean(
    text,
    [/等待我/i, /等我/i, /手动登录/i, /扫码登录/i, /人工登录/i],
    [/不要等待/i, /不等待/i, /无需等待/i],
    !headless,
  );

  const manualLoginTimeoutMs = parseManualTimeoutMs(text);
  const warnings = [];
  if (loginPassword) {
    warnings.push('Inline passwords are supported, but environment variables are safer than putting secrets in shell history.');
  }

  return {
    inputUrl,
    options: {
      headless,
      autoLogin,
      reuseLoginState,
      waitForManualLogin,
      ...(manualLoginTimeoutMs ? { manualLoginTimeoutMs } : {}),
      ...(loginUsername ? { loginUsername } : {}),
      ...(loginPassword ? { loginPassword } : {}),
    },
    warnings,
  };
}
