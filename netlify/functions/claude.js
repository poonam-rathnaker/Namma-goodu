exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // API key: prefer environment variable, fall back to key passed from browser
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    (event.headers['x-api-key']);

  if (!apiKey) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { message: 'No API key provided' } }),
    };
  }

  // Strip x-api-key from the forwarded body (it's not an Anthropic body field)
  const { ...anthropicBody } = body;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(anthropicBody),
  });

  const data = await response.text();

  return {
    statusCode: response.status,
    headers: { 'Content-Type': 'application/json' },
    body: data,
  };
};
