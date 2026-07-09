const RATE_LIMIT_MAX = 40;         // max chat messages per IP per window
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

async function checkRateLimit(ip) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return { limited: false, configured: false };
  }
  try {
    const key = `ratelimit:chat:${ip}`;
    const incrRes = await fetch(`${kvUrl}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const incrData = await incrRes.json();
    const count = incrData.result;
    if (count === 1) {
      await fetch(`${kvUrl}/expire/${encodeURIComponent(key)}/${RATE_LIMIT_WINDOW_SECONDS}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
    }
    return { limited: count > RATE_LIMIT_MAX, configured: true, count };
  } catch (err) {
    console.error('Rate limit check failed, allowing request:', err);
    return { limited: false, configured: true, error: true };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const rateStatus = await checkRateLimit(ip);
  if (!rateStatus.configured) {
    console.warn('KV_REST_API_URL / KV_REST_API_TOKEN not set - rate limiting is disabled.');
  }
  if (rateStatus.limited) {
    return res.status(429).json({ error: 'Too many chat messages from this connection. Please wait a while and try again.' });
  }

  const { profile, history } = req.body || {};
  if (!profile || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Missing profile or chat history' });
  }

  const trimmedHistory = history.slice(-20);
  const outputLanguage = profile.language && profile.language.trim() ? profile.language.trim() : 'English';

  const systemPrompt = `You are Dag Ett, a friendly and precise assistant helping someone through their first 90 days relocating to Sweden. Their profile: ${profile.citizenship}, moving for ${profile.purpose}, settling in ${profile.city}. Their generated plan intro was: "${profile.planIntro || ''}". Answer their questions in plain language, be specific to Swedish processes and their situation, and keep answers concise (3-6 sentences unless more detail is truly needed). Remember: EU/EEA citizens have "uppehallsratt" (right of residence), not an approved "residence permit" - do not describe it as needing Migrationsverket approval. Nordic citizens need no permit or right-of-residence proof at all. Non-EU family members of EU/EES citizens get "uppehallskort", which differs from a standard "uppehallstillstand". If you're not certain about a specific rule, say so and point them to the relevant authority's official site rather than guessing. Respond entirely in ${outputLanguage}, except keep official Swedish authority names (e.g. Skatteverket, Migrationsverket, Forsakringskassan) in their original Swedish form. Respond in plain text, not JSON or markdown.`;

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
        max_tokens: 600,
        system: systemPrompt,
        messages: trimmedHistory
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(502).json({ error: data?.error?.message || 'Upstream API error' });
    }

    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error during chat' });
  }
}
