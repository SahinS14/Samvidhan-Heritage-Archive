const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const { promisify } = require('util');

const root = __dirname;
const recordsFile = path.join(root, 'data', 'records.json');
const port = Number(process.env.PORT || 4173);
const tesseractBin = process.env.TESSERACT_BIN || '/opt/homebrew/bin/tesseract';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const run = promisify(execFile);
const archiveTopics = /\b(ambedkar|babasaheb|bhimrao|constitution|constitutional|constituent|article\s*\d+|fundamental rights|equality|liberty|fraternity|democracy|social justice|untouchability|caste|scheduled castes|buddhism|mahad|poona pact|manuscript|archive|speech|debate)\b/i;
const archiveSources = [
  { title: 'Speech on the Constitution', year: '1949', type: 'Speech', summary: 'Connects political democracy with social democracy, liberty, equality and fraternity.' },
  { title: 'Notes on social equality', year: 'c. 1930s', type: 'Manuscript', summary: 'Digitized manuscript notes on equality, rights and social justice.' },
  { title: 'Annihilation of Caste', year: '1936', type: 'Book', summary: 'A key work for researching caste, equality, education and society.' },
  { title: 'Constituent Assembly debate', year: '1948', type: 'Debate', summary: 'Curated constitutional debate record connected to rights and equality.' },
  { title: 'Constitutional principles: lecture audio', year: '1950', type: 'Audio', summary: 'Lecture record on democracy, equality and social justice.' }
];

async function readRecords() {
  try { return JSON.parse(await fs.readFile(recordsFile, 'utf8')); }
  catch { return []; }
}
async function writeRecords(records) {
  await fs.mkdir(path.dirname(recordsFile), { recursive: true });
  await fs.writeFile(recordsFile, JSON.stringify(records, null, 2));
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
async function formData(req) {
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: 'half' });
  return request.formData();
}
async function digitize(req) {
  const form = await formData(req);
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('An image file is required');
  const extension = path.extname(file.name || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('OCR supports JPG and PNG scans in this prototype');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 8_000_000) throw new Error('The scan is too large for this prototype');
  const uploadId = `scan-${Date.now()}${extension}`;
  const uploads = path.join(root, 'data', 'uploads');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'samvidhan-ocr-'));
  const tempFile = path.join(tempDir, `input${extension}`);
  try {
    await fs.mkdir(uploads, { recursive: true });
    await fs.writeFile(tempFile, buffer);
    await fs.writeFile(path.join(uploads, uploadId), buffer);
    const { stdout } = await run(tesseractBin, [tempFile, 'stdout', '-l', 'eng'], { timeout: 60000, maxBuffer: 2_000_000 });
    return { fileRef: `data/uploads/${uploadId}`, text: stdout.trim() || 'No readable text was detected. An archivist can add a verified transcript.', engine: 'Tesseract OCR' };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
function fallbackAnswer(question) {
  const lower = question.toLowerCase();
  if (lower.includes('article 17') || lower.includes('untouchability')) return { answer: 'Article 17 abolishes untouchability. For this archive, begin with constitutional debates and connect them to equality and dignity in the related speech records.', sources: ['Constituent Assembly debate · 1948', 'Speech on the Constitution · 1949'] };
  if (lower.includes('equal') || lower.includes('caste') || lower.includes('social justice')) return { answer: 'The archive connects equality and social justice with writings, manuscript notes and constitutional records. Compare the original record text before drawing a conclusion.', sources: ['Notes on social equality · c. 1930s', 'Annihilation of Caste · 1936', 'Speech on the Constitution · 1949'] };
  if (lower.includes('constitution') || lower.includes('democracy') || lower.includes('speech') || lower.includes('debate')) return { answer: 'The constitutional research path combines speeches with Constituent Assembly debates. The related records focus on democracy, rights, equality, liberty and fraternity.', sources: ['Speech on the Constitution · 1949', 'Constituent Assembly debate · 1948'] };
  return { answer: 'This question is within the archive’s scope. Search the related source records to compare original texts, catalogued materials and constitutional context.', sources: archiveSources.slice(0, 3).map(source => `${source.title} · ${source.year}`) };
}
async function askArchive(question) {
  if (!archiveTopics.test(question)) return { inScope: false, answer: 'I can only help with Dr. B. R. Ambedkar, the Constitution of India, related constitutional debates, and this archive’s records.', sources: [] };
  const fallback = fallbackAnswer(question);
  if (!process.env.OPENAI_API_KEY) return { inScope: true, ...fallback, mode: 'source-guided fallback' };
  const additionalRecords = await readRecords();
  const sourceContext = [...archiveSources, ...additionalRecords.slice(-8).map(record => ({ title: record.title, year: record.date || 'Date not listed', type: record.type, summary: record.desc || record.body || 'Institutional archive record.' }))]
    .map(source => `- ${source.title} (${source.year}; ${source.type}): ${String(source.summary).slice(0, 420)}`).join('\n');
  const instructions = `You are the Samvidhan Heritage Archive research assistant. Answer only questions about Dr. B. R. Ambedkar, his writings and legacy, the Constitution of India, constituent debates, constitutional rights, and the provided archive records. Refuse all other topics in one short sentence. Use only the supplied archive context for factual claims; if it does not support an answer, say what source is needed. Be concise, neutral and educational. Do not invent quotations, citations, dates, or archival holdings. End with a line beginning \"Suggested source path:\" followed by 1–3 relevant provided source titles.\n\nArchive context:\n${sourceContext}`;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-6-astra', instructions, input: question, max_output_tokens: 420 }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('model request failed');
    const data = await response.json();
    const answer = String(data.output_text || '').trim();
    if (!answer) throw new Error('empty model response');
    return { inScope: true, answer, sources: fallback.sources, mode: 'OpenAI API' };
  } catch { return { inScope: true, ...fallback, mode: 'source-guided fallback' }; }
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/health') return send(res, 200, { status: 'healthy', service: 'samvidhan-archive' });
  if (url.pathname === '/api/records' && req.method === 'GET') return send(res, 200, await readRecords());
  if (url.pathname === '/api/live-records' && req.method === 'GET') {
    const safeTerm = (url.searchParams.get('q') || 'Ambedkar').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 80) || 'Ambedkar';
    const params = new URLSearchParams({ q: `title:(${safeTerm})`, 'fl[]': 'identifier,title,year,creator,mediatype', rows: '5', page: '1', output: 'json' });
    try {
      const response = await fetch(`https://archive.org/advancedsearch.php?${params}`, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'SamvidhanHeritageArchive/1.0' } });
      if (!response.ok) throw new Error('upstream unavailable');
      const data = await response.json();
      const records = (data.response?.docs || []).filter(item => item.identifier && item.title).map(item => ({
        identifier: item.identifier,
        title: item.title,
        year: item.year || 'Date not listed',
        creator: Array.isArray(item.creator) ? item.creator[0] : item.creator || 'Internet Archive record',
        type: item.mediatype || 'record',
        url: `https://archive.org/details/${encodeURIComponent(item.identifier)}`
      }));
      return send(res, 200, { source: 'Internet Archive', query: safeTerm, records });
    } catch { return send(res, 503, { error: 'Live public archive is temporarily unavailable', records: [] }); }
  }
  if (url.pathname === '/api/ask' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await readBody(req));
      const question = String(payload.question || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 1200);
      if (!question) return send(res, 400, { error: 'A question is required.' });
      return send(res, 200, await askArchive(question));
    } catch { return send(res, 400, { error: 'Invalid chat request.' }); }
  }
  if (url.pathname === '/api/records' && req.method === 'POST') {
    try {
      const record = JSON.parse(await readBody(req));
      if (!record.title || !record.type || !record.id) return send(res, 400, { error: 'title, type and id are required' });
      const records = await readRecords();
      records.push({ ...record, publishedAt: new Date().toISOString() });
      await writeRecords(records);
      return send(res, 201, { ok: true, record });
    } catch { return send(res, 400, { error: 'invalid record payload' }); }
  }
  if (url.pathname === '/api/digitize' && req.method === 'POST') {
    try { return send(res, 200, await digitize(req)); }
    catch (error) { return send(res, 400, { error: error.message || 'OCR could not process this scan' }); }
  }
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(root, requestPath));
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const data = await fs.readFile(filePath);
    send(res, 200, data, mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  } catch { send(res, 404, 'Not found', 'text/plain'); }
}).listen(port, () => console.log(`Samvidhan Archive running at http://127.0.0.1:${port}`));
