import { defineConfig } from 'vite';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { csv } from './src/gtfs.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const columns = ['sequence', 'stop_id', 'stop_name', 'use', 'stop_lat', 'stop_lon', 'source', 'note'];

// 정류장 편집기의 저장 버튼: 개발 서버에서만 data/stops.csv를 쓰고 GTFS를 다시 만듭니다.
function saveStops() {
  return {
    name: 'save-stops',
    configureServer(server) {
      server.middlewares.use('/api/stops', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          try {
            const rows = csv(body);
            if (!rows.length || columns.some(c => !(c in rows[0]))) throw new Error('stops.csv 열이 맞지 않습니다.');
            for (const r of rows) {
              const lat = Number(r.stop_lat), lon = Number(r.stop_lon);
              if (!(lat > 37.44 && lat < 37.47 && lon > 127.12 && lon < 127.14)) throw new Error(`${r.stop_name} 좌표가 캠퍼스 밖입니다.`);
            }
            // 직전 파일은 stops.prev.csv로 남깁니다.
            copyFileSync(`${root}data/stops.csv`, `${root}data/stops.prev.csv`);
            writeFileSync(`${root}data/stops.csv`, body);
            res.end(execFileSync(process.execPath, ['scripts/build-gtfs.mjs'], { cwd: root, encoding: 'utf8' }));
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error.stderr || error.message));
          }
        });
      });
    },
  };
}

// 입력값 편집기의 저장 버튼: 개발 서버에서만 data/의 service·demand·destinations.csv를 씁니다.
// 열 이름이 원래 파일과 같은지 확인하고, 직전 파일은 *.prev.csv로 남깁니다. service.csv를 바꾸면 GTFS를 다시 만듭니다.
const editable = ['service', 'demand', 'destinations'];
function saveData() {
  return {
    name: 'save-data',
    configureServer(server) {
      server.middlewares.use('/api/data/', (req, res) => {
        const name = req.url.replace(/^\//, '').split('?')[0];
        if (req.method !== 'POST' || !editable.includes(name)) { res.statusCode = 404; res.end(); return; }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          try {
            const file = `${root}data/${name}.csv`;
            const old = readFileSync(file, 'utf8').replace(/^﻿/, '');
            const header = text => text.replace(/^﻿/, '').split(/\r?\n/)[0];
            if (header(body) !== header(old)) throw new Error(`${name}.csv 열 이름이 원래 파일과 다릅니다.`);
            if (!csv(body).length) throw new Error(`${name}.csv에 행이 없습니다.`);
            copyFileSync(file, `${root}data/${name}.prev.csv`);
            writeFileSync(file, '﻿' + body);
            res.end(name === 'service'
              ? execFileSync(process.execPath, ['scripts/build-gtfs.mjs'], { cwd: root, encoding: 'utf8' })
              : `${name}.csv를 저장했습니다.`);
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error.stderr || error.message));
          }
        });
      });
    },
  };
}

// GitHub Pages로 올릴 때(PAGES_BASE가 있을 때)는 대시보드만 빌드합니다. 편집기는 내 컴퓨터의 개발 서버에서만 저장되기 때문입니다.
const pages = process.env.PAGES_BASE;
export default defineConfig({
  base: pages ?? '/',
  plugins: [saveStops(), saveData()],
  build: { rollupOptions: { input: pages ? { main: `${root}index.html` } : { main: `${root}index.html`,
    editor: `${root}stop-editor.html`, inputs: `${root}input-editor.html` } } },
});
