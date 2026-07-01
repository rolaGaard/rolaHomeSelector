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

  function extractFromUrl(url) {
    // Extract clues from the URL slug itself
    const slug = decodeURIComponent(url).replace(/-/g, ' ').replace(/_/g, ' ');
    const domain = new URL(url).hostname.replace('www.','');
    const agencyMap = {
      'mirandabosch.com':'Miranda Bosch','ljramos.com.ar':'L.J. Ramos',
      'zonaprop.com.ar':'ZonaProp','argenprop.com':'Argenprop',
      'remax.com.ar':'RE/MAX','toribio.com.ar':'Toribio Achaval',
      'bullrich.com.ar':'Bullrich','mercadolibre.com.ar':'Mercado Libre',
      'properati.com.ar':'Properati','coldwellbanker.com.ar':'Coldwell Banker',
    };
    const agency = agencyMap[domain] || domain.replace(/\.(com|ar|com\.ar)$/,'').replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    // Try to find address in slug
    const addrMatch = slug.match(/(?:en |en-)?([A-Z][a-záéíóúñü.\s]+\s+\d{3,5})/i) ||
                      slug.match(/([A-Z][a-záéíóúñü]+\s+y\s+[A-Z][a-záéíóúñü]+)/i);
    const address = addrMatch ? addrMatch[1].trim() : null;
    return { agency, address };
  }

  // ── EXTRACT MODE ──────────────────────────────────────────────────────────
  if (mode === 'extract' && urlToFetch) {
    const urlClues = extractFromUrl(urlToFetch);
    let html = '';
    let fetchError = null;

    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10000);
      const pageRes = await fetch(urlToFetch, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9'
        },
        signal: ctrl.signal
      });
      html = await pageRes.text();
    } catch(e) {
      fetchError = e.message;
    }

    // Extract og/twitter meta tags
    const ogImage = getMeta(html, [
      /property=["']og:image["'][^>]+content=["']([^"']{15,})["']/i,
      /content=["']([^"']{15,})["'][^>]+property=["']og:image["']/i,
      /name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']{15,})["']/i,
      /content=["']([^"']{15,})["'][^>]+name=["']twitter:image["']/i,
    ]);
    const ogTitle = getMeta(html, [
      /property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    ]);
    const ogDesc = getMeta(html, [
      /property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    ]);
    const ogSite = getMeta(html, [
      /property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    ]);

    // Try to find image deeper: JSON-LD, data-src, first big jpg/png
    let deepImage = ogImage;
    if (!deepImage && html) {
      // JSON-LD
      const jsonld = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const block of jsonld) {
        const inner = block.replace(/<[^>]+>/g,'');
        try {
          const obj = JSON.parse(inner);
          const img = obj.image || obj['@image'] || (obj.offers && obj.offers.image);
          if (img) { deepImage = typeof img === 'string' ? img : (img.url || img[0]); break; }
        } catch {}
      }
      // data-src / data-lazy / data-original with https image urls
      if (!deepImage) {
        const m = html.match(/data-(?:src|lazy|original)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|webp|png)[^"']*)["']/i);
        if (m) deepImage = m[1];
      }
      // src= in img tags with https
      if (!deepImage) {
        const imgs = [...html.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|webp|png)[^"']*)["']/gi)];
        const big = imgs.find(m => !m[1].includes('logo') && !m[1].includes('icon') && !m[1].includes('avatar') && !m[1].includes('thumb'));
        if (big) deepImage = big[1];
      }
    }

    // Extract price directly from meta tags with regex (before Claude)
    const allText = [ogTitle, ogDesc, ogSite].join(' ');
    let directPrice = null;
    const pricePatterns = [
      /U(?:\$|SD|ss?)\s*S?\s*([\d.,]+(?:\.\d{3})*)/i,
      /([\d]{2,3}(?:[.,]\d{3})+)\s*(?:USD|U\$S|dolares|dólares)/i,
      /\$\s*([\d]{2,3}(?:[.,]\d{3})+)/,
    ];
    for (const pat of pricePatterns) {
      const m = allText.match(pat);
      if (m) {
        const raw = m[0].trim();
        // Determine if USD
        const isUSD = /U\$|USD|u\$s|dolares|dólares/i.test(raw + allText.substring(0, 50));
        directPrice = isUSD ? raw.replace(/^.*?(USD|U\$S?)\s*/i, 'USD ').trim() : raw;
        break;
      }
    }

    // Build page info for Claude
    const domain = new URL(urlToFetch).hostname.replace('www.','');
    const pageInfo = [
      `URL: ${urlToFetch}`,
      `dominio: ${domain}`,
      `og:image: ${deepImage || '(no encontrado)'}`,
      `og:title: ${ogTitle || '(no encontrado)'}`,
      `og:description: ${ogDesc || '(no encontrado)'}`,
      `og:site_name: ${ogSite || '(no encontrado)'}`,
      directPrice ? `precio detectado: ${directPrice}` : '',
      fetchError ? `nota: no se pudo acceder a la pagina (${fetchError})` : '',
    ].filter(Boolean).join('\n');

    // Claude extracts structured data
    const extractSystem = `Sos un extractor de datos inmobiliarios argentinos experto.
Respondé SOLO con JSON válido, sin backticks, sin texto adicional.
Formato exacto:
{"image_url":"URL de foto o null","price":"precio como USD 280.000 o $ 85.000.000 o null","agency":"inmobiliaria o null","address":"dirección corta como Av. Santa Fe y Azcuénaga, Recoleta o null"}
REGLAS IMPORTANTES:
- Si hay un campo "precio detectado" en el input, USALO como price (no lo ignores).
- Si og:title contiene USD o $ seguido de números, ese es el precio.
- Si og:description menciona precio, usalo.
- Si el dominio es mirandabosch.com la agencia es Miranda Bosch.
- Para la address: extraela del og:title, og:description, o del slug de la URL.
- Solo pon null si realmente no hay ningún dato disponible.`;

    let extracted = { image_url: deepImage || null, price: null, agency: urlClues.agency, address: urlClues.address };

    try {
      const aRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250,
          system: extractSystem,
          messages: [{ role: 'user', content: pageInfo }]
        })
      });
      const aData = await aRes.json();
      const claudeText = (aData.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      let parsed = null;
      try { parsed = JSON.parse(claudeText.replace(/```json?/g,'').replace(/```/g,'').trim()); } catch {}
      if (!parsed) { const m = claudeText.match(/\{[\s\S]*?\}/); if (m) try { parsed = JSON.parse(m[0]); } catch {} }
      if (parsed) {
        extracted = {
          image_url: parsed.image_url || deepImage || null,
          price:     parsed.price   || directPrice || null,
          agency:    parsed.agency  || urlClues.agency,
          address:   parsed.address || urlClues.address || (ogTitle ? ogTitle.split('|')[0].trim() : null),
        };
      }
    } catch(e) {
      // Claude failed - use what we have from meta tags + URL
      extracted.price = directPrice || null;
      extracted.address = urlClues.address || (ogTitle ? ogTitle.split('|')[0].trim() : null);
    }

    return res.status(200).json({ extracted });
  }

  // ── GENERAL CHAT MODE ─────────────────────────────────────────────────────
  try {
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: system || 'Sos un asistente inmobiliario amigable en español rioplatense.',
        messages: (messages || []).length ? messages : [{ role: 'user', content: 'Hola' }]
      })
    });
    const text = await aRes.text();
    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(200).json({ content: [{ type: 'text', text }] });
    }
  } catch(e) {
    return res.status(200).json({ content: [{ type: 'text', text: `Error: ${e.message}` }] });
  }
};
