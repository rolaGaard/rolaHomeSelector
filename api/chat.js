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

    // 1. Fetch the page (try real browser UA first, then Googlebot)
    const fetchHeaders = [
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-AR,es;q=0.9' },
      { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    ];
    for (const headers of fetchHeaders) {
      if (html) break;
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 8000);
        const pr = await fetch(urlToFetch, { headers, signal: ctrl.signal });
        const text = await pr.text();
        if (text.length > 500) html = text;
      } catch(e) {}
    }

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

    // Extract surface area
    let surface = null;
    const surfaceMatch = allText.match(/(\d{2,4})\s*m[²2](?:\s*(?:tot|cub|total|cubierta))?/i) ||
                         allText.match(/superficie[^\d]*(\d{2,4})/i) ||
                         allText.match(/sup\.?\s*tot[^\d]*(\d{2,4})/i);
    if (surfaceMatch) {
      const num = (surfaceMatch[1] || surfaceMatch[2] || '').trim();
      if (num && parseInt(num) > 15 && parseInt(num) < 5000) surface = num + ' m²';
    }

    // 5. Extract address from og:title / URL slug
    let address = null;
    const titleClean = (ogTitle || pageTitle).replace(/[-|–]\s*.{0,30}$/, '').trim();
    if (titleClean.length > 4 && titleClean.length < 80) address = titleClean;
    const agency = agencyFromDomain(domain);

    // 6. ── SCREENSHOT + CLAUDE VISION (if price still missing) ──────────────
    if (!price) {
      const visionPrompt = `Esta es una captura de pantalla de una página de inmobiliaria argentina (${domain}).
Extraé los datos visibles y respondé SOLO con JSON válido, sin texto adicional:
{"price":"precio como USD 430.000 o $ 85.000.000 o null","address":"dirección completa: si es intersección poné ej. Av Las Heras y Ayacucho, Recoleta; si es altura poné ej. Juncal al 2100, Recoleta; siempre incluí el barrio","surface":"superficie total como 163 m² o null","agency":"nombre de inmobiliaria o null"}`;

      async function tryVision(imgBase64, contentType) {
        const visionData = await callClaude({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: contentType || 'image/jpeg', data: imgBase64 } },
            { type: 'text', text: visionPrompt }
          ]}]
        });
        const txt = (visionData.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        const parsed = parseJSON(txt);
        if (parsed) {
          price   = parsed.price   || price;
          address = parsed.address || address;
          surface = parsed.surface || surface;
          return true;
        }
        return false;
      }

      // Service 1: thum.io (no API key)
      let visionDone = false;
      try {
        const r = await fetch(`https://image.thum.io/get/width/1280/crop/900/noanimate/${encodeURIComponent(urlToFetch)}`);
        if (r.ok && r.headers.get('content-type')?.startsWith('image')) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 5000) { // real image, not error page
            visionDone = await tryVision(Buffer.from(buf).toString('base64'), r.headers.get('content-type'));
          }
        }
      } catch(e) {}

      // Service 2: microlink.io (free, 100/day, gets screenshot URL then fetches it)
      if (!visionDone) {
        try {
          const mlRes = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(urlToFetch)}&screenshot=true&meta=false&embed=screenshot.url`);
          const mlData = await mlRes.json();
          const screenshotUrl = mlData?.data?.screenshot?.url;
          if (screenshotUrl) {
            const imgRes = await fetch(screenshotUrl);
            if (imgRes.ok) {
              const buf = await imgRes.arrayBuffer();
              visionDone = await tryVision(Buffer.from(buf).toString('base64'), imgRes.headers.get('content-type') || 'image/jpeg');
            }
          }
        } catch(e) {}
      }
    }

    return res.status(200).json({
      extracted: { image_url: image || null, price: price || null, agency, address, surface: surface || null }
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
