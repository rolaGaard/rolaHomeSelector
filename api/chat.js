module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, urlToFetch } = req.body;

  let finalMessages = messages;

  if (urlToFetch) {
    let pageContext = `URL: ${urlToFetch}\n`;
    try {
      const pageRes = await fetch(urlToFetch, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-AR,es;q=0.9'
        },
        signal: AbortSignal.timeout(8000)
      });
      const html = await pageRes.text();

      const ogImage   = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
                         html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i))?.[1] || '';
      const ogTitle   = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i))?.[1] || '';
      const ogDesc    = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i))?.[1] || '';
      const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
      const bodyText  = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 3000);

      pageContext += `og:image: ${ogImage}\nog:title: ${ogTitle}\nog:description: ${ogDesc}\npage title: ${pageTitle}\nbody: ${bodyText}`;
    } catch (e) {
      pageContext += `Error al acceder: ${e.message}`;
    }

    finalMessages = [{ role: 'user', content: `Extraé los datos de esta propiedad:\n\n${pageContext}` }];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages: finalMessages
      })
    });

    const data = await response.json();

    // Log error details so they appear in Vercel logs
    if (!response.ok) {
      console.error('Anthropic error:', response.status, JSON.stringify(data));
      // Return the full error to the client so we can debug
      return res.status(200).json({
        content: [{ type: 'text', text: `DEBUG ERROR ${response.status}: ${JSON.stringify(data)}` }]
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    console.error('Function error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
