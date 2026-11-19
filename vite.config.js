import { defineConfig } from 'vite';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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

// 보고서 편집기: final_project/최종보고서.docx 본문을 읽고, 편집한 내용을 초안(report-draft.json)과
// 새 워드 파일(최종보고서_편집본.docx)로 저장합니다. 원본 워드 파일은 바꾸지 않습니다.
const project = `${root}../final_project/`;
const reportFiles = { source: `${project}최종보고서.docx`, output: `${project}최종보고서_편집본.docx`,
  draft: `${project}report-draft.json`, outline: `${project}report_outline.md` };
const python = (args, input) => execFileSync('python', ['-I', `${root}scripts/report_docx.py`, ...args],
  { cwd: root, encoding: 'utf8', input, env: { ...process.env, PYTHONUTF8: '1' } });
function reportEditor() {
  return {
    name: 'report-editor',
    configureServer(server) {
      server.middlewares.use('/api/report', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const [path, query = ''] = req.url.split('?');
        const fail = error => { res.statusCode = 400; res.end(JSON.stringify({ error: String(error.stderr || error.message).trim() })); };
        if (req.method === 'GET') {
          try {
            if (path === '/outline') { res.end(JSON.stringify({ text: readFileSync(reportFiles.outline, 'utf8') })); return; }
            // 그림 목록과 그림 파일: final_project/figures의 PNG·JPG
            if (path === '/figures') {
              const list = existsSync(`${project}figures`) ? readdirSync(`${project}figures`).filter(f => /\.(png|jpe?g)$/i.test(f)) : [];
              res.end(JSON.stringify({ files: list })); return;
            }
            if (path.startsWith('/figure/')) {
              const name = decodeURIComponent(path.slice('/figure/'.length));
              if (name.includes('/') || name.includes('\\') || !existsSync(`${project}figures/${name}`)) { res.statusCode = 404; res.end('{}'); return; }
              res.setHeader('Content-Type', /\.png$/i.test(name) ? 'image/png' : 'image/jpeg');
              res.end(readFileSync(`${project}figures/${name}`)); return;
            }
            const fresh = query.includes('fresh=1') || !existsSync(reportFiles.draft);
            const data = fresh ? JSON.parse(python(['read', reportFiles.source])) : JSON.parse(readFileSync(reportFiles.draft, 'utf8'));
            res.end(JSON.stringify({ ...data, from: fresh ? 'docx' : 'draft' }));
          } catch (error) { fail(error); }
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            // 편집기는 블록만 보내므로, 초안에 있던 목차 수정(toc) 같은 다른 값은 그대로 이어 둡니다.
            const previous = existsSync(reportFiles.draft) ? JSON.parse(readFileSync(reportFiles.draft, 'utf8')) : {};
            const data = { ...previous, ...JSON.parse(body) };
            if (!Array.isArray(data.blocks)) throw new Error('블록이 없습니다.');
            writeFileSync(reportFiles.draft, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 1));
            if (path === '/draft') { res.end(JSON.stringify({ draft: reportFiles.draft })); return; }
            if (path === '/save') { res.end(python(['write', reportFiles.source, reportFiles.output], JSON.stringify(data))); return; }
            // 쪽수 확인: 임시 워드 파일을 만들어 워드로 실제 쪽수를 셉니다(표지·목차 포함).
            if (path === '/pages') {
              const temp = `${tmpdir()}/mudang-report-pages.docx`;
              python(['write', reportFiles.source, temp], JSON.stringify(data));
              const pages = execFileSync('powershell', ['-NoProfile', '-File', `${root}scripts/count-pages.ps1`, temp], { encoding: 'utf8' }).trim();
              res.end(JSON.stringify({ pages: Number(pages) })); return;
            }
            res.statusCode = 404; res.end('{}');
          } catch (error) {
            fail(/EBUSY|Permission denied|PermissionError/.test(String(error.stderr || error.message))
              ? new Error('최종보고서_편집본.docx가 워드에서 열려 있습니다. 워드에서 닫은 뒤 다시 저장해 주세요.') : error);
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
  plugins: [saveStops(), saveData(), reportEditor()],
  build: { rollupOptions: { input: pages ? { main: `${root}index.html` } : { main: `${root}index.html`,
    editor: `${root}stop-editor.html`, inputs: `${root}input-editor.html`, report: `${root}report-editor.html` } } },
});
