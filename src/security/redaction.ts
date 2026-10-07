export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of url.searchParams.keys()) {
      if (
        /token|password|secret|key|auth|cookie|signature|credential/i.test(key)
      )
        url.searchParams.set(key, '[REDACTED]');
    }
    return url.href.slice(0, 512);
  } catch {
    return '[unavailable URL]';
  }
}
export function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url))
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:password|token|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 1024);
}
