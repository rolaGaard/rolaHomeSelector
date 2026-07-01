module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, urlToFetch, mode } = req.body;

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function getMeta(html, patterns) {
    for (const p of patterns) { const m = html.match(p); if (m?.[1]?.trim()) return m[1].trim(); }
    return '';
  }

  function agencyFromDomain(domain) {
    const map = {
      'mirandabosch.com':'Miranda Bosch','ljramos.com.ar':'L.J. Ramos',
      'zonaprop.com.ar':'ZonaProp','argenprop.com':'Argenprop',
      'remax.com.ar':'RE/MAX','toribio.com.ar':'Toribio Achaval',
      'bullrich.com.ar':'Bullrich','mercadolibre.com.ar':'Mercado Libre',
      'properati.com.ar':'Properati','coldwellbanker.com.ar':'Coldwell Banker',
      'navent.com':'Navent','ciudad.com.ar':'Ciudad',
    };
    return map[domain] || domain.replace(/\.(com|ar|com\.ar)$/,'').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }

  function findPrice(text) {
    if (!text) return null;
    const m = text.match(/USD\s*([\d.,]+(?:\.?\d{3})*)|U\$S\s*([\d.,]+)|\$\s*([\d]{2,3}(?:[.,]\d{3})+)/i);
    if (!m) return null;
    const raw = m[0].trim();
    return /USD|U\$S/i.test(raw) ? 'USD ' + raw.replace(/^(?:USD|U\$S)\s*/i,'').trim() : raw;
  }

  async function callClaude(body) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  function parseJSON(text) {
    if (!text) return null;
    try { return JSON.parse(text.replace(/```json?/g,'').replace(/```/g,'').trim()); } catch {}
    const m = text.match(/\{[\s\S]*?\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }

  // ── EXTRACT MODE ──────────────────────────────────────────────────────────
  if (mode === 'extract' && urlToFetch) {
    const domain = new URL(urlToFetch).hostname.replace('www.','');
    let html = '';

    // 1. Fetch the page
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 9000);
      const pr = await fetch(urlToFetch, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: ctrl.signal
      });
      html = await pr.text();
    } catch(e) { /* site blocked or timeout */ }

    // 2. Extract meta tags + basic info
    const ogImage  = getMeta(html, [/property=["']og:image["'][^>]+content=["']([^"']{15,})["']/i, /content=["']([^"']{15,})["'][^>]+property=["']og:image["']/i, /name=["']twitter:image["'][^>]+content=["']([^"']{15,})["']/i]);
    const ogTitle  = getMeta(html, [/property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /content=["']([^"']+)["'][^>]+property=["']og:title["']/i]);
    const ogDesc   = getMeta(html, [/property=["']og:description["'][^>]+content=["']([^"']+)["']/i, /content=["']([^"']+)["'][^>]+property=["']og:description["']/i]);
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';

    // 3. Try to find image deeper
    let image = ogImage;
    if (!image && html) {
      const jsonldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      for (const b of jsonldBlocks) {
        try { const o = JSON.parse(b[1]); if (o.image) { image = typeof o.image === 'string' ? o.image : o.image.url || o.image[0]; break; } } catch {}
      }
      if (!image) { const m = html.match(/data-(?:src|lazy|original)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|webp|png)[^"']*)["']/i); if (m) image = m[1]; }
      if (!image) { const imgs = [...html.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|webp|png)[^"']*)["']/gi)]; const big = imgs.find(m=>!m[1].includes('logo')&&!m[1].includes('icon')&&!m[1].includes('thumb')); if (big) image = big[1]; }
    }

    // 4. Try to find price in text sources
    const scriptText = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join(' ').substring(0,6000);
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').substring(0,8000);
    const allText = [pageTitle, ogTitle, ogDesc, scriptText, bodyText].join(' | ');
    let price = findPrice(allText);

    // 5. Extract address from og:title / URL slug
    let address = null;
    const titleClean = (ogTitle || pageTitle).replace(/[-|–]\s*.{0,30}$/, '').trim();
    if (titleClean.length > 4 && titleClean.length < 80) address = titleClean;
    const agency = agencyFromDomain(domain);

    // 6. ── SCREENSHOT + CLAUDE VISION (if price still missing) ──────────────
    if (!price) {
      try {
        // thum.io: free screenshot service, no API key needed
        const thumbUrl = `https://image.thum.io/get/width/1280/crop/900/noanimate/${encodeURIComponent(urlToFetch)}`;
        const imgRes = await fetch(thumbUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
        if (imgRes.ok) {
          const imgBuffer = await imgRes.arrayBuffer();
          const imgBase64 = Buffer.from(imgBuffer).toString('base64');
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

          const visionData = await callClaude({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: contentType, data: imgBase64 } },
                { type: 'text', text: `Esta es una captura de pantalla de una página de inmobiliaria argentina (${domain}).
Extraé los datos visibles y respondé SOLO con JSON válido, sin texto adicional:
{"price":"precio como USD 430.000 o $ 85.000.000 o null","address":"dirección como Juncal al 2100 Recoleta o null","agency":"nombre de inmobiliaria o null","image_url":null}` }
              ]
            }]
          });

          const visionText = (visionData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
          const visionParsed = parseJSON(visionText);
          if (visionParsed) {
            price   = visionParsed.price   || price;
            address = visionParsed.address || address;
          }
        }
      } catch(e) { /* screenshot failed, use what we have */ }
    }

    return res.status(200).json({
      extracted: { image_url: image || null, price: price || null, agency, address }
    });
  }

  // ── GENERAL CHAT MODE ─────────────────────────────────────────────────────
  try {
    const data = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: system || 'Sos un asistente inmobiliario amigable en español rioplatense.',
      messages: (messages||[]).length ? messages : [{ role:'user', content:'Hola' }]
    });
    return res.status(200).json(data);
  } catch(e) {
    return res.status(200).json({ content:[{ type:'text', text:`Error: ${e.message}` }] });
  }
};
