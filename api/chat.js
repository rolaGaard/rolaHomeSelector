module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, urlToFetch } = req.body;

  let finalMessages = messages;

  // If a property URL was provided, fetch the page server-side and pass HTML to Claude
  if (urlToFetch) {
    let pageContext = '';
    try {
      const pageRes = await fetch(urlToFetch, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9'
        }
      });
      const html = await pageRes.text();

      // Extract og meta tags
      const ogImage   = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
                         html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i))?.[1] || '';
      const ogTitle   = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i))?.[1] || '';
      const ogDesc    = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i))?.[1] || '';
      const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';

      // Strip scripts/styles and take first 4000 chars of body text
      const bodyText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 4000);

      pageContext = `URL: ${urlToFetch}
og:image: ${ogImage}
og:title: ${ogTitle}
og:description: ${ogDesc}
page title: ${pageTitle}
body text (primeros 4000 chars): ${bodyText}`;

    } catch (e) {
      pageContext = `URL: ${urlToFetch}\nError al acceder a la página: ${e.message}`;
    }

    finalMessages = [{
      role: 'user',
      content: `Extraé los datos de esta propiedad inmobiliaria.\n\n${pageContext}`
    }];
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
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
