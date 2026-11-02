import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** Load only the two actual pure TS crypto modules; no app/Prisma substitution. */
export async function loadFixtureCrypto() {
  const compile = async path => ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const cacheURL = moduleURL(await compile('src/lib/crypto/tenant-data-key-cache.ts'));
  const encryption = (await compile('src/lib/crypto/tenant-pii-encryption.ts'))
    .replace('"@/lib/crypto/tenant-data-key-cache"', JSON.stringify(cacheURL));
  return { ...await import(moduleURL(encryption)), ...await import(cacheURL) };
}
