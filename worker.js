const archiveTopics = /\b(ambedkar|babasaheb|bhimrao|constitution|constitutional|constituent|article\s*\d+|fundamental rights|equality|liberty|fraternity|democracy|social justice|untouchability|caste|scheduled castes|buddhism|mahad|poona pact|manuscript|archive|speech|debate)\b/i;

const archiveSources = [
  { title: 'Speech on the Constitution', year: '1949', type: 'Speech', summary: 'Connects political democracy with social democracy, liberty, equality and fraternity.' },
  { title: 'Notes on social equality', year: 'c. 1930s', type: 'Manuscript', summary: 'Digitized manuscript notes on equality, rights and social justice.' },
  { title: 'Annihilation of Caste', year: '1936', type: 'Book', summary: 'A key work for researching caste, equality, education and society.' },
  { title: 'Constituent Assembly debate', year: '1948', type: 'Debate', summary: 'Curated constitutional debate record connected to rights and equality.' }
];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function fallbackAnswer(question) {
  const lower = question.toLowerCase();
  if (lower.includes('article 17') || lower.includes('untouchability')) return { answer: 'Article 17 abolishes untouchability. For this archive, begin with constitutional debates and connect them to equality and dignity in the related speech records.', sources: ['Constituent Assembly debate · 1948', 'Speech on the Constitution · 1949'] };
  if (lower.includes('equal') || lower.includes('caste') || lower.includes('social justice')) return { answer: 'The archive connects equality and social justice with writings, manuscript notes and constitutional records. Compare the original record text before drawing a conclusion.', sources: ['Notes on social equality · c. 1930s', 'Annihilation of Caste · 1936', 'Speech on the Constitution · 1949'] };
  return { answer: 'This question is within the archive’s scope. Search the related source records to compare original texts, catalogued materials and constitutional context.', sources: archiveSources.slice(0, 3).map(source => `${source.title} · ${source.year}`) };
}

async function askArchive(question, env) {
  if (!archiveTopics.test(question)) return { inScope: false, answer: 'I can only help with Dr. B. R. Ambedkar, the Constitution of India, related constitutional debates, and this archive’s records.', sources: [] };
  const fallback = fallbackAnswer(question);
  if (!env.OPENAI_API_KEY) return { inScope: true, ...fallback, mode: 'source-guided fallback' };
  const sourceContext = archiveSources.map(source => `- ${source.title} (${source.year}; ${source.type}): ${source.summary}`).join('\n');
  const instructions = `You are the Samvidhan Heritage Archive research assistant. Answer only questions about Dr. B. R. Ambedkar, his writings and legacy, the Constitution of India, constituent debates, constitutional rights, and the provided archive records. Refuse all other topics in one short sentence. Use only the supplied archive context for factual claims; if it does not support an answer, say what source is needed. Be concise, neutral and educational. Do not invent quotations, citations, dates, or archival holdings. End with a line beginning "Suggested source path:" followed by 1–3 relevant provided source titles.\n\nArchive context:\n${sourceContext}`;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-6-astra', instructions, input: question, max_output_tokens: 420 })
    });
    if (!response.ok) throw new Error('Model request failed');
    const data = await response.json();
    const answer = String(data.output_text || '').trim();
    return answer ? { inScope: true, answer, sources: fallback.sources, mode: 'OpenAI API' } : { inScope: true, ...fallback, mode: 'source-guided fallback' };
  } catch {
    return { inScope: true, ...fallback, mode: 'source-guided fallback' };
  }
}

async function liveRecords(url) {
  const safeTerm = (url.searchParams.get('q') || 'Ambedkar').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 80) || 'Ambedkar';
  const params = new URLSearchParams({ q: `title:(${safeTerm})`, 'fl[]': 'identifier,title,year,creator,mediatype', rows: '5', page: '1', output: 'json' });
  try {
    const response = await fetch(`https://archive.org/advancedsearch.php?${params}`);
    if (!response.ok) throw new Error('Public archive unavailable');
    const data = await response.json();
    const records = (data.response?.docs || []).filter(item => item.identifier && item.title).map(item => ({
      identifier: item.identifier,
      title: item.title,
      year: item.year || 'Date not listed',
      creator: Array.isArray(item.creator) ? item.creator[0] : item.creator || 'Internet Archive record',
      type: item.mediatype || 'record',
      url: `https://archive.org/details/${encodeURIComponent(item.identifier)}`
    }));
    return json({ source: 'Internet Archive', query: safeTerm, records });
  } catch {
    return json({ error: 'Live public archive is temporarily unavailable', records: [] }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ status: 'healthy', service: 'samvidhan-archive' });
    if (url.pathname === '/api/live-records' && request.method === 'GET') return liveRecords(url);
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      try {
        const payload = await request.json();
        const question = String(payload.question || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 1200);
        return question ? json(await askArchive(question, env)) : json({ error: 'A question is required.' }, 400);
      } catch { return json({ error: 'Invalid chat request.' }, 400); }
    }
    if (url.pathname === '/api/digitize' || (url.pathname === '/api/records' && request.method === 'POST')) {
      return json({ error: 'Institutional OCR and catalogue submission run on the archive server deployment.' }, 501);
    }
    if (url.pathname === '/api/records') return json([]);
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
