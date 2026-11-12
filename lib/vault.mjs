import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Single-user, local-only vault. Protects copied DB files; not a substitute for OS account security.
export function createVault(directory) {
  mkdirSync(directory, { recursive: true });
  const keyPath = join(directory, 'integration.key'), path = join(directory, 'integrations.enc');
  if (!existsSync(keyPath)) {
    if (existsSync(path)) throw new Error('연동 암호화 키가 없습니다. 백업한 integration.key를 복구하세요.');
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = readFileSync(keyPath);
  const read = () => {
    if (!existsSync(path)) return {};
    const bytes = readFileSync(path), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  };
  return {
    get: name => read()[name],
    set(name, value) {
      const data = read(); data[name] = value;
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
      writeFileSync(path + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    },
  };
}
