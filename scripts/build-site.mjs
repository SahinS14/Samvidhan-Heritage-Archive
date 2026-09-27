import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const client = path.join(dist, 'client');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await cp(path.join(root, 'worker.js'), path.join(dist, 'server', 'index.js'));
await writeFile(path.join(dist, 'server', 'package.json'), JSON.stringify({ type: 'module' }));
for (const file of ['index.html', 'login.html', 'signup.html', 'pre.html', 'archive.html', 'admin.html', 'api-config.js']) {
  await cp(path.join(root, file), path.join(client, file), { recursive: true });
}
await cp(path.join(root, 'assets'), path.join(client, 'assets'), { recursive: true });
await cp(path.join(root, 'data', 'records.json'), path.join(client, 'data', 'records.json'));
