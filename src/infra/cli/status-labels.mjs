// @ts-check

export function resultStatusLabel(status) {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return '部分成功';
}

export function resultBuildStatusLabel(result = /** @type {any} */ ({})) {
  const report = result.user_report ?? result.userReport ?? {};
  if (report.result_status === 'success') return resultStatusLabel('success');
  if (report.result_status === 'failed') return resultStatusLabel('failed');
  if (result.status === 'success') return resultStatusLabel('success');
  if (result.status === 'failed') return resultStatusLabel('failed');
  return resultStatusLabel('partial');
}

export function buildStatusLabel(value) {
  if (value === 'success') return '成功';
  if (value === 'blocked') return '已阻止';
  if (value === 'failed') return '失败';
  return value ?? '-';
}

export function verificationStatusLabel(value) {
  if (value === 'passed') return '通过';
  if (value === 'failed') return '失败';
  if (value === 'registered') return '已注册';
  if (value === 'skipped') return '已跳过';
  return value ?? '-';
}

export function setupStatusLabel(value, fallback = (label) => String(label ?? '')) {
  if (value === 'success') return '成功';
  if (value === 'created') return '已创建';
  if (value === 'updated') return '已更新';
  if (value === 'reused') return '已复用';
  if (value === 'failed') return '失败';
  if (value === 'blocked') return '已阻止';
  return fallback(value);
}

export function completionVerificationLabel(value) {
  return value === 'passed' ? '通过' : '未通过';
}

export function completionCurrentOutputLabel(value) {
  return value === true ? '已更新' : '未更新';
}

export function completionRegistryLabel(value) {
  return value === true ? '已注册' : '未注册';
}

export function collectionStatusLabel(value) {
  if (value === 'candidate') return '候选';
  if (value === 'discarded') return '丢弃';
  if (value === 'skipped') return '已跳过';
  if (value === 'failed') return '失败';
  if (value === 'blocked') return '已阻止';
  if (value === 'error') return '错误';
  return String(value ?? '-');
}
