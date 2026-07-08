export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { profile, history } = req.body || {};
  if (!profile || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'Missing profile or chat history' });
  }

  const trimmedHistory = history.slice(-20);

  const systemPrompt = `You are Dag Ett, a friendly and precise assistant helping someone through their first 90 days relocating to Sweden. Their profile: ${profile.citizenship}, moving for ${profile.purpose}, settling in ${profile.city}. Their generated plan intro was: "${profile.planIntro || ''}". Answer their questions in plain language, be specific to Swedish processes and their situation, and keep answers concise (3-6 sentences unless more detail is truly needed). If you're not certain about a specific rule, say so and point them to the relevant authority's official site rather than guessing. Respond in plain text, not JSON or markdown.`;

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
