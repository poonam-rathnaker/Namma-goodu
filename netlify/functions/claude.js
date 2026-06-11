exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || event.headers['x-api-key'];
  if (!apiKey) {
    return { statusCode: 401, body: JSON.stringify({ error: { message: 'No API key provided' } }) };
  }

  const propertyUrl = body.propertyUrl;

  // --- Step 1: Fetch the listing page server-side ---
  let pageText = '';
  if (propertyUrl) {
    try {
      const pageRes = await fetch(propertyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-AU,en;q=0.9',
        }
      });
      const html = await pageRes.text();

      // Pull out just the useful text — strip scripts/styles, keep ~12k chars
      pageText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 12000);
    } catch (e) {
      pageText = '';
    }
  }

  // --- Step 2: Ask Claude to extract structured data from the page text ---
  const messages = pageText
    ? [{
        role: 'user',
        content: `Extract property listing details from this page content and return ONLY raw JSON (no markdown, no backticks).

Page content:
${pageText}

Return exactly this JSON shape:
{
  "address": "full street address including unit/lot number",
  "suburb": "suburb name",
  "priceGuide": "$1,400,000 or Guide $1.4M or Contact Agent",
  "bedrooms": 3,
  "bathrooms": 2,
  "parking": 1,
  "propertyType": "townhouse/house/apartment",
  "internalSize": "127m² or null",
  "description": "first 2-3 sentences of listing description",
  "inspections": [{"date": "Saturday 14 Jun", "time": "10:00am - 10:30am"}],
  "auctionDate": "Saturday 20 Jun 11:00am or null",
  "agent": "agent full name",
  "agency": "agency name",
  "schoolCatchment": "primary school name or null",
  "outgoings": "strata/council/water fees or null"
}
Use null for unknown fields. Include ALL upcoming inspections.`
      }]
    : body.messages; // fallback to whatever the browser sent

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages,
    }),
  });

  const data = await anthropicRes.text();
  return {
    statusCode: anthropicRes.status,
    headers: { 'Content-Type': 'application/json' },
    body: data,
  };
};
