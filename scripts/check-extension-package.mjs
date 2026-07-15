import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  roots.push('.');
}

const textExtensions = new Set(['.js', '.json', '.html', '.css', '.md', '.txt']);
const shareOnlyBlockedTerms = [
  'GMGN 盯盘伴侣',
  'TechMelon',
  '0xTechMelon',
  'elonmusk',
  '马斯克',
  'heyibinance',
  '何一',
  'cz_binance',
  'CZ专属',
  '马斯克专属',
  '何一专属',
  '🍉',
];

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function readManifest(root) {
  const manifestPath = path.join(root, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function exactRelativePathExists(root, relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  let current = root;

  for (const part of parts) {
    const entries = fs.readdirSync(current);
    if (!entries.includes(part)) return false;
    current = path.join(current, part);
  }

  return fs.existsSync(current);
}

function checkRequiredFiles(root, manifest, errors) {
  const manifestFiles = new Set([
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
  ].filter(Boolean));
  for (const relativePath of manifestFiles) {
    const fullPath = path.join(root, relativePath);
    if (!exactRelativePathExists(root, relativePath)) {
      errors.push(`${root}: missing manifest file ${relativePath}`);
    } else if (fs.statSync(fullPath).size === 0) {
      errors.push(`${root}: empty manifest file ${relativePath}`);
    }
  }

  const iconPaths = new Set();
  for (const value of Object.values(manifest.icons || {})) iconPaths.add(value);
  for (const value of Object.values(manifest.action?.default_icon || {})) iconPaths.add(value);

  for (const iconPath of iconPaths) {
    const fullPath = path.join(root, iconPath);
    if (!exactRelativePathExists(root, iconPath)) {
      errors.push(`${root}: missing icon ${iconPath}`);
    } else if (fs.statSync(fullPath).size === 0) {
      errors.push(`${root}: empty icon ${iconPath}`);
    }
  }

  for (const group of manifest.web_accessible_resources || []) {
    for (const resource of group.resources || []) {
      const fullPath = path.join(root, resource);
      if (!exactRelativePathExists(root, resource)) {
        errors.push(`${root}: missing web_accessible_resource ${resource}`);
      } else if (fs.statSync(fullPath).size === 0) {
        errors.push(`${root}: empty web_accessible_resource ${resource}`);
      }
    }
  }
}

function checkManifestPolicy(root, manifest, errors) {
  const allowedPermissions = new Set(['storage', 'unlimitedStorage']);
  const allowedHosts = new Set([
    'https://*.gmgn.ai/*',
    'https://gmgn.ai/*',
    'https://*.tts.speech.microsoft.com/*',
  ]);
  const allowedContentMatches = new Set(['https://*.gmgn.ai/*', 'https://gmgn.ai/*']);

  if (manifest.manifest_version !== 3) errors.push(`${root}: manifest_version must be 3`);
  if (manifest.update_url) errors.push(`${root}: update_url is not allowed`);
  for (const permission of manifest.permissions || []) {
    if (!allowedPermissions.has(permission)) errors.push(`${root}: unexpected permission ${permission}`);
  }
  for (const host of manifest.host_permissions || []) {
    if (!allowedHosts.has(host)) errors.push(`${root}: unexpected host permission ${host}`);
  }
  for (const script of manifest.content_scripts || []) {
    for (const match of script.matches || []) {
      if (!allowedContentMatches.has(match)) errors.push(`${root}: unexpected content-script match ${match}`);
    }
  }
}

function checkShareCopy(root, errors) {
  for (const file of walkFiles(root)) {
    if (file.includes(`${path.sep}lib${path.sep}`)) continue;
    if (!textExtensions.has(path.extname(file))) continue;

    const text = fs.readFileSync(file, 'utf8');
    for (const term of shareOnlyBlockedTerms) {
      if (text.includes(term)) {
        errors.push(`${root}: blocked share term "${term}" in ${path.relative(root, file)}`);
      }
    }
  }
}

const errors = [];

for (const root of roots) {
  const manifest = readManifest(root);
  checkRequiredFiles(root, manifest, errors);
  checkManifestPolicy(root, manifest, errors);
  checkShareCopy(root, errors);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Checked ${roots.length} extension package${roots.length === 1 ? '' : 's'}.`);
