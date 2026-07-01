module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, urlToFetch } = req.body;

  // Check env var
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({
      content: [{ type: 'text', text: '❌ DEBUG: ANTHROPIC_API_KEY no está configurada en Vercel' }]
    });
  }

  let finalMessages = messages || [];

  // Server-side page fetch
  if (urlToFetch) {
    let pageInfo = `URL: ${urlToFetch}\n`;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 9000);
      const pageRes = await fetch(urlToFetch, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' },
        signal: ctrl.signal
      });
      const html = await pageRes.text();
      // Only extract og tags - small payload
      const ogImage = html.match(/property=["']og:image["'][^>]+content=["']([^"']{10,}?)["']/i)?.[1] ||
                      html.match(/content=["']([^"']{10,}?)["'][^>]+property=["']og:image["']/i)?.[1] || '';
      const ogTitle = html.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
                      html.match(/content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] || '';
      const ogDesc  = html.match(/property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
                      html.match(/content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] || '';
      const ogSite  = html.match(/property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
      const domain  = new URL(urlToFetch).hostname.replace('www.','');
      pageInfo += `dominio: ${domain}\nog:image: ${ogImage}\nog:title: ${ogTitle}\nog:description: ${ogDesc}\nog:site_name: ${ogSite}`;
    } catch(e) {
      pageInfo += `Error al fetchear: ${e.message}`;
    }
    finalMessages = [{ role: 'user', content: pageInfo }];
  }

  // Call Anthropic
  let anthropicRes, responseText;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: system || '',
        messages: finalMessages
      })
    });
    responseText = await anthropicRes.text();
  } catch(e) {
    return res.status(200).json({
      content: [{ type: 'text', text: `❌ DEBUG fetch error: ${e.message}` }]
    });
  }

  if (!anthropicRes.ok) {
    // Return error as readable message instead of 500
    return res.status(200).json({
      content: [{ type: 'text', text: `❌ DEBUG Anthropic ${anthropicRes.status}: ${responseText}` }]
    });
  }

  try {
    return res.status(200).json(JSON.parse(responseText));
  } catch(e) {
    return res.status(200).json({
      content: [{ type: 'text', text: `❌ DEBUG parse error: ${responseText}` }]
    });
  }
};
