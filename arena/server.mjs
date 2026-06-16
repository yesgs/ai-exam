import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = process.env.PORT || 3456;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico': 'image/x-icon',
};

function mime(path) {
  const ext = extname(path).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// Scan /project directory to discover projects and their model submissions
async function scanProjects() {
  const projectRoot = join(ROOT, 'project');
  let projectDirs;
  try {
    projectDirs = await readdir(projectRoot);
  } catch {
    return [];
  }

  const projects = [];
  for (const dir of projectDirs) {
    const dirPath = join(projectRoot, dir);
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) continue;

    // Check for prompt.md
    let prompt = '';
    try {
      prompt = await readFile(join(dirPath, 'prompt.md'), 'utf-8');
    } catch {}

    // Scan model subdirectories
    let modelDirs;
    try {
      modelDirs = await readdir(dirPath);
    } catch {
      modelDirs = [];
    }

    const models = [];
    for (const modelDir of modelDirs) {
      const modelPath = join(dirPath, modelDir);
      let modelStat;
      try {
        modelStat = await stat(modelPath);
      } catch { continue; }
      if (!modelStat.isDirectory()) continue;

      // Find HTML file: prefer index.html, fall back to any .html file
      let htmlFile = 'index.html';
      try {
        await stat(join(modelPath, 'index.html'));
      } catch {
        const files = await readdir(modelPath);
        const html = files.find(f => f.endsWith('.html'));
        if (html) htmlFile = html;
        else continue;
      }

      models.push({ id: modelDir, htmlFile });
    }

    if (models.length > 0) {
      projects.push({ id: dir, name: dir, prompt: prompt.trim(), models });
    }
  }
  return projects;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = normalize(decodeURIComponent(url.pathname));

    // API: return project structure
    if (filePath === '/api/projects') {
      const projects = await scanProjects();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(projects));
      return;
    }

    // Security: prevent directory traversal
    const resolved = join(ROOT, filePath);
    if (!resolved.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Try to serve the file
    let stats;
    try {
      stats = await stat(resolved);
    } catch {
      // File not found - serve arena index for /arena
      if (filePath === '/arena' || filePath === '/arena/') {
        const arenaHtml = await readFile(join(ROOT, 'arena', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(arenaHtml);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // If directory, try index.html
    let actualPath = resolved;
    if (stats.isDirectory()) {
      const indexPath = join(resolved, 'index.html');
      try {
        await stat(indexPath);
        actualPath = indexPath;
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Directory</h1></body></html>');
        return;
      }
    }

    const contentType = mime(actualPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(actualPath).pipe(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`
🏟️  AI 竞技场已启动！
`);
  console.log(`   地址: http://localhost:${PORT}/arena`);
  console.log(`   API:  http://localhost:${PORT}/api/projects`);
  console.log(`   根目录: ${ROOT}`);
  console.log(`
   按 Ctrl+C 停止服务
`);
});
