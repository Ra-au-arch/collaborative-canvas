import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

// Ensure output directories exist
fs.mkdirSync(path.join(rootDir, 'dist/public'), { recursive: true });
fs.mkdirSync(path.join(rootDir, 'dist/server'), { recursive: true });

// Copy static assets (index.html, style.css)
function copyStaticFiles() {
  fs.copyFileSync(
    path.join(rootDir, 'client/index.html'),
    path.join(rootDir, 'dist/public/index.html')
  );
  fs.copyFileSync(
    path.join(rootDir, 'client/style.css'),
    path.join(rootDir, 'dist/public/style.css')
  );
  console.log('✅ Static assets copied to dist/public');
}

copyStaticFiles();

// Client build config
const clientConfig = {
  entryPoints: [path.join(rootDir, 'client/main.ts')],
  bundle: true,
  outfile: path.join(rootDir, 'dist/public/bundle.js'),
  format: 'esm',
  sourcemap: true,
  minify: isProd,
  target: ['es2022', 'chrome100', 'firefox100', 'safari15'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }
};

// Server build config
const serverConfig = {
  entryPoints: [path.join(rootDir, 'server/server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(rootDir, 'dist/server/server.js'),
  sourcemap: true,
  packages: 'external',
  banner: {
    // Enable require / import.meta compatibility if needed
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`
  }
};

async function build() {
  try {
    if (isWatch) {
      const clientCtx = await esbuild.context(clientConfig);
      const serverCtx = await esbuild.context(serverConfig);
      await clientCtx.watch();
      await serverCtx.watch();

      fs.watch(path.join(rootDir, 'client'), (eventType, filename) => {
        if (filename === 'index.html' || filename === 'style.css') {
          copyStaticFiles();
        }
      });

      console.log('👀 Watching client and server for changes...');
    } else {
      await esbuild.build(clientConfig);
      await esbuild.build(serverConfig);
      console.log('⚡ Client and Server build complete!');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
