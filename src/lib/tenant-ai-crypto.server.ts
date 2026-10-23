import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
function encryptionKey() {
  const secret = process.env['TENANT_AI_ENCRYPTION_SECRET'];
  if (!secret) throw new Error('AI key storage is unavailable.');
  return createHash('sha256').update(secret).digest();
}
export function encryptAiKey(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decryptAiKey(value: string, context: string): string {
  try {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new Error('Your AI connection needs to be reconnected.'); }
}