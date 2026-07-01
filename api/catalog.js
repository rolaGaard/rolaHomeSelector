const CATALOG_FILE = 'catalog.json';

function ghHeaders() {
  return {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'rolaHomeSelector'
  };
}

function ghUrl() {
  const repo = process.env.GITHUB_REPO; // e.g. "rolagaard/rolaHomeSelector"
  return `https://api.github.com/repos/${repo}/contents/${CATALOG_FILE}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = ghUrl();

  // ── GET: load catalog ──────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const r = await fetch(url, { headers: ghHeaders() });
      if (r.status === 404) return res.json({ properties: [] });
      if (!r.ok) return res.status(r.status).json({ error: `GitHub error ${r.status}` });
      const data = await r.json();
      const raw = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
      return res.json(JSON.parse(raw));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PUT: save catalog ──────────────────────────────────────
  if (req.method === 'PUT') {
    try {
      const { properties } = req.body;
      const content = Buffer.from(JSON.stringify({ properties }, null, 2)).toString('base64');

      // Get current SHA (needed to update existing file)
      let sha;
      const getR = await fetch(url, { headers: ghHeaders() });
      if (getR.ok) {
        const getData = await getR.json();
        sha = getData.sha;
      }

      const body = {
        message: `rolaHomeSelector update ${new Date().toISOString()}`,
        content,
        branch: 'main'
      };
      if (sha) body.sha = sha;

      const putR = await fetch(url, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify(body)
      });

      if (!putR.ok) {
        const err = await putR.json().catch(() => ({}));
        return res.status(putR.status).json({ error: err.message || `GitHub save ${putR.status}` });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
