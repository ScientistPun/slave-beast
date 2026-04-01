import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEB_PORT || 8080;

const contentTypes = {
  'html': 'text/html',
  'js': 'application/javascript',
  'css': 'text/css',
  'json': 'application/json',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = join(__dirname, 'public', filePath);

  const ext = filePath.split('.').pop();

  if (existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Web前端已启动 http://localhost:${PORT}`);
});
