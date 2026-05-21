// @ts-check

export function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export const escapeHtmlAttribute = escapeHtmlText;
export const htmlEscape = escapeHtmlText;
