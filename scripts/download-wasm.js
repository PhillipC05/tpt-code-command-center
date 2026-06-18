/**
 * Downloads pre-built tree-sitter language WASM files from GitHub releases.
 * Run once before packaging: `node scripts/download-wasm.js`
 *
 * Files land in media/wasm/ and are whitelisted in .vscodeignore so they ship
 * inside the .vsix. The main tree-sitter runtime WASM is copied from
 * node_modules/web-tree-sitter (already a dependency).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const WASM_DIR = path.join(__dirname, '..', 'media', 'wasm');

// Pre-built WASM releases from the tree-sitter organization and community grammars.
// Update these version tags when newer grammar releases are available.
const WASM_FILES = [
  {
    name: 'tree-sitter-typescript.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm',
  },
  {
    name: 'tree-sitter-javascript.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm',
  },
  {
    name: 'tree-sitter-python.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm',
  },
  {
    name: 'tree-sitter-go.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm',
  },
  {
    name: 'tree-sitter-rust.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm',
  },
  {
    name: 'tree-sitter-java.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm',
  },
  {
    name: 'tree-sitter-c_sharp.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm',
  },
  {
    name: 'tree-sitter-php.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.23.11/tree-sitter-php.wasm',
  },
  {
    name: 'tree-sitter-ruby.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm',
  },
];

function download(url, destPath, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve(download(res.headers.location, destPath, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(WASM_DIR, { recursive: true });

  // Copy the runtime WASM from node_modules (no network needed)
  const runtimeSrc = path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
  const runtimeDest = path.join(WASM_DIR, 'tree-sitter.wasm');
  if (fs.existsSync(runtimeSrc)) {
    fs.copyFileSync(runtimeSrc, runtimeDest);
    console.log('  copied  tree-sitter.wasm (runtime)');
  } else {
    console.warn('  WARN: web-tree-sitter WASM not found — run npm install first');
  }

  // Download language grammars
  for (const { name, url } of WASM_FILES) {
    const dest = path.join(WASM_DIR, name);
    if (fs.existsSync(dest)) {
      console.log(`  exists  ${name}`);
      continue;
    }
    process.stdout.write(`  downloading ${name} ...`);
    try {
      await download(url, dest);
      console.log(' done');
    } catch (e) {
      console.error(` FAILED: ${e.message}`);
    }
  }

  console.log(`\nWASM files written to ${WASM_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
