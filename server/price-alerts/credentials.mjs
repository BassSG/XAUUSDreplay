import {randomBytes, createECDH} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw Error('Specify an absolute output path outside the repository');
const keys = createECDH('prime256v1');
keys.generateKeys();
const values = {
  ALERT_ACCESS_TOKEN: randomBytes(32).toString('base64url'),
  VAPID_PUBLIC_KEY: keys.getPublicKey('base64url', 'uncompressed'),
  VAPID_PRIVATE_KEY: keys.getPrivateKey('base64url'),
};
await writeFile(output, JSON.stringify(values, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log('Created a new credentials file. Keep it outside the repository.');
