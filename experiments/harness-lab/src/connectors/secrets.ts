import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { RequestError } from '../contracts/errors.js';
import { readControlled } from '../resources/files.js';

export interface EncryptedSecret { keyId: string; iv: string; tag: string; ciphertext: string }
const unavailable = () => new RequestError('CONNECTOR_KEY_UNAVAILABLE', '连接凭证密钥不可用，请核对外置密钥文件及版本。', 503);
/** Keys live outside the data root; ciphertext and its reference commit in one SQLite transaction. */
export class ConnectorSecrets {
  private constructor(private readonly keys: Map<string, Buffer>, readonly activeKeyId?: string) {}
  static async open(dataDir: string, keyFile?: string): Promise<ConnectorSecrets> {
    if (!keyFile) return new ConnectorSecrets(new Map());
    if (!isAbsolute(keyFile)) throw unavailable();
    const rel = relative(resolve(dataDir), resolve(keyFile));
    if (!rel || !rel.startsWith('..') && !isAbsolute(rel)) throw unavailable();
    const stat = await lstat(keyFile).catch(() => { throw unavailable(); });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw unavailable();
    try {
      const raw = JSON.parse((await readControlled(keyFile, 32 * 1024))!) as { activeKeyId: string; keys: Record<string, string> };
      if (!raw || typeof raw.activeKeyId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.activeKeyId) || !raw.keys || Object.keys(raw.keys).length > 32) throw unavailable();
      const keys = new Map<string, Buffer>();
      for (const [id, value] of Object.entries(raw.keys)) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw unavailable();
        const key = Buffer.from(value, 'base64'); if (key.length !== 32 || key.toString('base64') !== value) throw unavailable(); keys.set(id, key);
      }
      if (!keys.has(raw.activeKeyId)) throw unavailable();
      return new ConnectorSecrets(keys, raw.activeKeyId);
    } catch { throw unavailable(); }
  }
  assertKey(id: string): void { if (!this.keys.has(id)) throw unavailable(); }
  encrypt(value: string, context: string): EncryptedSecret {
    if (!this.activeKeyId) throw unavailable();
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { keyId: this.activeKeyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }
  decrypt(secret: EncryptedSecret, context: string): string {
    this.assertKey(secret.keyId);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.keys.get(secret.keyId)!, Buffer.from(secret.iv, 'base64'));
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw unavailable(); }
  }
  /** Keyed receipts do not leave a reusable bare hash of a low entropy API key. */
  receiptDigest(input: string, keyId = this.activeKeyId): string {
    if (!keyId) throw unavailable(); this.assertKey(keyId);
    return `secret:${keyId}:${createHmac('sha256', this.keys.get(keyId)!).update(input).digest('hex')}`;
  }
}
