export function mayRegisterAppCache(input: { production: boolean; hostname: string; embedded: boolean; search: string; delegatedPreviewHostname?: string }) {
  const hostname = input.hostname.toLowerCase();
  const label = hostname.split('.')[0] ?? '';
  const managedDomain = ['lovable.app', 'gpt-eng.com', 'gptengineer.run'].some(domain => hostname.endsWith(`.${domain}`));
  const preview = managedDomain && (/^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(label) || /^project--.+-dev$/.test(label));
  const internalDomain = ['lovableproject.com', 'lovableproject-dev.com', 'beta.lovable.dev'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  return input.production && !input.embedded && !preview && !internalDomain && hostname !== input.delegatedPreviewHostname?.toLowerCase() && new URLSearchParams(input.search).get('sw') !== 'off';
}

// The existing Firebase worker owns /. A more specific scope preserves its
// registration/token and controls the installed app launched at /dashboard,
// including subsequent client-side navigation throughout the workspace.
export const APP_CACHE_SCOPE = '/dashboard';