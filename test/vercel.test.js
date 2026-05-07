const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('vercel config uses serverless express entrypoint and no next build', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

  assert.equal(pkg.scripts['vercel-build'], 'node scripts/vercel-build.js');
  assert.equal(vercel.buildCommand, 'npm run vercel-build');
  assert.equal(vercel.installCommand, 'npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/');
  const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
  assert.match(npmrc, /registry=https:\/\/registry\.npmjs\.org\//);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.destination === '/api/index.js'));
  assert.equal(pkg.engines.node, '22.x');
});

test('vercel serverless entrypoint exports an express app handler', () => {
  const handler = require('../api/index');
  assert.equal(typeof handler, 'function');
  assert.equal(typeof handler.use, 'function');
});
