export function oauthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const target = new URL(value, 'https://app.invalid');
    if (target.origin !== 'https://app.invalid' || target.pathname.startsWith('//')) return '/';
    return target.pathname + target.search + target.hash;
  } catch { return '/'; }
}