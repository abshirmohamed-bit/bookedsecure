import { describe, expect, it } from 'vitest';
import { oauthReturnPath } from './oauth-return-path';
describe('OAuth sign-in return path', () => {
  it('preserves the full consent request through sign in and signup', () => {
    expect(oauthReturnPath('/.lovable/oauth/consent?authorization_id=request-123#review')).toBe('/.lovable/oauth/consent?authorization_id=request-123#review');
  });
  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '/\n/evil.example', undefined])('rejects unsafe return destinations %s', value => {
    expect(oauthReturnPath(value)).toBe('/');
  });
});