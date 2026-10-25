// Read-only static server for the isolated production-build acceptance suite.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
const root = resolve('.output/public')
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' }
createServer(async (request, response) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return }
    try { if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html') } catch { path = resolve(root, 'index.html') }
    response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'cache-control':'no-store' })
    response.end(await readFile(path))
  } catch { response.writeHead(404).end() }
}).listen(51329, '127.0.0.1')
