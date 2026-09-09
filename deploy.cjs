/**
 * deploy.cjs
 *
 * Fetches fresh restaurant data and deploys to GitHub Pages.
 * Usage: node deploy.cjs <bearer-token>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const TOKEN_FILE = path.join(DIR, '.rappi-token');

function getToken() {
  const arg = process.argv[2];
  if (arg) { fs.writeFileSync(TOKEN_FILE, arg); return arg; }
  try { return fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); }
  catch { return null; }
}

function run(cmd, allowFail = false) {
  try {
    return execSync(cmd, { cwd: DIR, encoding: 'utf-8', stdio: 'pipe' });
  } catch (e) {
    if (allowFail) return e.stdout || '';
    throw e;
  }
}

const token = getToken();
if (!token) {
  console.error('Usage: node deploy.cjs <bearer-token>');
  process.exit(1);
}

console.log('Fetching restaurants...');
run(`node fetch-restaurants.mjs ${token}`);
console.log('Data fetched\n');

console.log('Deploying to GitHub Pages...');

const branch = run('git branch --show-current').trim();
run('git stash');
run('git checkout gh-pages');
run('git add restaurants.json');
const committed = run('git commit -m "data: update restaurants"', true);

if (committed.includes('nothing to commit')) {
  console.log('No changes to deploy');
} else {
  run('git push origin gh-pages');
  console.log('Deployed! https://jamerwolf.github.io/rappi-maps/');
}

run(`git checkout ${branch}`);
run('git stash pop', true);
