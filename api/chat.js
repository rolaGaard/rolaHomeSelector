module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, urlToFetch, mode } = req.body;

  // ── PROPERTY EXTRACTION MODE ──────────────────────────────────────────────
  if (mode === 'extract' && urlToFetch) {
    // 1. Fetch the page server-side
    let pageInfo = `URL analizada: ${urlToFetch}\n`;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 9000);
      const pageRes = await fetch(urlToFetch, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' },
        signal: ctrl.signal
      });
      const html = await pageRes.text();
      const get = (patterns) => { for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1]; } return ''; };
      const ogImage = get([/property=["']og:image["'][^>]+content=["']([^"']{10,})["']/i, /content=["']([^"']{10,})["'][^>]+property=["']og:image["']/i, /name=["']twitter:image["'][^>]+content=["']([^"']{10,})["']/i]);
      const ogTitle = get([/property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /content=["']([^"']+)["'][^>]+property=["']og:title["']/i]);
      const ogDesc  = get([/property=["']og:description["'][^>]+content=["']([^"']+)["']/i, /content=["']([^"']+)["'][^>]+property=["']og:description["']/i]);
      const ogSite  = get([/property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i, /content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i]);
      const domain  = new URL(urlToFetch).hostname.replace('www.','');
      pageInfo += `dominio: ${domain}\nog:image: ${ogImage}\nog:title: ${ogTitle}\nog:description: ${ogDesc}\nog:site_name: ${ogSite}`;
    } catch(e) {
      pageInfo += `(no se pudo acceder a la pagina: ${e.message})`;
    }

    // 2. Ask Claude to extract structured data
    const extractSystem = `Sos un extractor de datos inmobiliarios. Analizás información de páginas de inmobiliarias argentinas.
Respondé SOLO con un objeto JSON válido. Sin backticks. Sin texto antes ni después. Solo el JSON.
Formato exacto:
{"image_url":"URL de la foto principal o null","price":"precio como USD 280.000 o $ 85.000.000 o null","agency":"nombre de la inmobiliaria o null","address":"dirección corta como Juncal al 2100, Recoleta o null"}`;

    let claudeText = '';
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: extractSystem,
          messages: [{ role: 'user', content: pageInfo }]
        })
      });
      const data = await anthropicRes.json();
      claudeText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    } catch(e) {
      return res.status(200).json({ error: `Claude error: ${e.message}` });
    }

    // 3. Parse JSON from Claude's response (handle any extra text)
    let parsed = null;
    try {
      const clean = claudeText.replace(/```json?/g,'').replace(/```/g,'').trim();
      parsed = JSON.parse(clean);
    } catch {
      const m = claudeText.match(/\{[\s\S]*?\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }

    if (!parsed) {
      // Claude couldn't parse → return what we got from og tags directly
      const ogImage = pageInfo.match(/og:image: (.+)/)?.[1]?.trim() || null;
      const ogTitle = pageInfo.match(/og:title: (.+)/)?.[1]?.trim() || null;
      const domain  = new URL(urlToFetch).hostname.replace('www.','').replace(/\.(com|ar|com\.ar)$/,'');
      parsed = { image_url: ogImage, price: null, agency: domain, address: ogTitle };
    }

    return res.status(200).json({ extracted: parsed });
  }

  // ── GENERAL CHAT MODE ─────────────────────────────────────────────────────
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: system || '',
        messages: messages || []
      })
    });
    const data = await anthropicRes.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
