exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const apiKey = process.env.ANTHROPIC_API_KEY || event.headers['x-api-key'];
  if (!apiKey) {
    return { statusCode: 401, body: JSON.stringify({ error: { message: 'No API key provided' } }) };
  }

  const propertyUrl = body.propertyUrl;
  if (!propertyUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: 'propertyUrl is required' } }) };
  }

  // Try to fetch the listing page directly
  let pageContent = null;
  try {
    const pageRes = await fetch(propertyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.9',
      }
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 15000);
    }
  } catch (e) { /* page fetch failed, will use web search fallback */ }

  // Build the Claude request
  let claudeBody;

  if (pageContent) {
    // Best case: we have the page HTML, just ask Claude to extract
    claudeBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Extract property details from this listing page text. Return ONLY a raw JSON object, no markdown fences, no explanation.

PAGE TEXT:
${pageContent}

JSON shape to return:
{"address":"full street address","suburb":"suburb","priceGuide":"$1.2M or Contact Agent","bedrooms":3,"bathrooms":2,"parking":1,"propertyType":"house/townhouse/apartment","internalSize":"120m² or null","description":"2-3 sentence description","inspections":[{"date":"Saturday 14 Jun","time":"10:00am - 10:30am"}],"auctionDate":"date or null","agent":"name","agency":"agency","schoolCatchment":"school or null","outgoings":"fees or null"}

Use null for any missing field. Include every upcoming inspection found.`
      }]
    };
  } else {
    // Fallback: use web_search tool to find the listing
    claudeBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for this property listing and extract its details: ${propertyUrl}

Return ONLY a raw JSON object (no markdown, no explanation):
{"address":"full street address","suburb":"suburb","priceGuide":"$1.2M or Contact Agent","bedrooms":3,"bathrooms":2,"parking":1,"propertyType":"house/townhouse/apartment","internalSize":"120m² or null","description":"2-3 sentence description","inspections":[{"date":"Saturday 14 Jun","time":"10:00am - 10:30am"}],"auctionDate":"date or null","agent":"name","agency":"agency","schoolCatchment":"school or null","outgoings":"fees or null"}

Use null for missing fields. Include all upcoming inspections.`
      }]
    };
  }

  // Agentic loop to handle tool use (web_search fallback may need multiple turns)
  const messages = claudeBody.messages;
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...claudeBody, messages }),
    });

    const data = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, headers: { 'Content-Type': 'application/json' }, body: data };
    }

    const json = JSON.parse(data);

    if (json.stop_reason === 'end_turn') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: data };
    }

    if (json.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: json.content });
      const results = json.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.content || '' }));
      messages.push({ role: 'user', content: results });
      continue;
    }

    // Any other stop reason — return whatever we got
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: data };
  }

  return { statusCode: 500, body: JSON.stringify({ error: { message: 'Could not extract property data after multiple attempts' } }) };
};
