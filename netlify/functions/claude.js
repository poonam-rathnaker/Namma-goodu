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

  // Extract listing ID and suburb from URL for a precise search query
  const listingId = (propertyUrl.match(/(\d{8,})/) || [])[1] || '';
  const suburbanMatch = propertyUrl.match(/(?:nsw|vic|qld|sa|wa|tas|act|nt)-(.+?)-\d/);
  const suburb = suburbanMatch ? suburbanMatch[1].replace(/-/g, ' ') : '';
  const site = propertyUrl.includes('domain.com.au') ? 'domain.com.au' : 'realestate.com.au';

  const searchQuery = listingId
    ? `${listingId} ${suburb} ${site} property listing inspections`
    : `${propertyUrl}`;

  const messages = [{
    role: 'user',
    content: `Search for this Australian property listing and return its details as JSON.

Search for: "${searchQuery}"

The listing URL is: ${propertyUrl}

After searching, you MUST return ONLY a JSON object. No explanation, no markdown fences. If you cannot find some details, use null. You must always return valid JSON.

Required format:
{"address":"full street address","suburb":"suburb name","priceGuide":"$X or Contact Agent","bedrooms":3,"bathrooms":2,"parking":1,"propertyType":"townhouse","internalSize":"120m² or null","description":"2-3 sentences","inspections":[{"date":"Saturday 14 Jun","time":"10:00am - 10:30am"}],"auctionDate":"date or null","agent":"name or null","agency":"agency or null","schoolCatchment":null,"outgoings":null}

If you truly cannot find anything, return: {"address":null,"suburb":null,"priceGuide":null,"bedrooms":null,"bathrooms":null,"parking":null,"propertyType":null,"internalSize":null,"description":null,"inspections":[],"auctionDate":null,"agent":null,"agency":null,"schoolCatchment":null,"outgoings":null}`
  }];

  const claudeBody = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  };

  for (let turn = 0; turn < 8; turn++) {
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
      const toolResults = json.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.content || '' }));
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: data };
  }

  return {
    statusCode: 500,
    body: JSON.stringify({ error: { message: 'Could not retrieve property data' } })
  };
};
