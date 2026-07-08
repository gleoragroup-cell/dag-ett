export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { citizenship, purpose, city, language } = req.body || {};
  if (!citizenship || !purpose || !city) {
    return res.status(400).json({ error: 'Missing citizenship, purpose, or city' });
  }
  const outputLanguage = language && language.trim() ? language.trim() : 'English';

  const systemPrompt = `You are Dag Ett, an assistant that creates practical relocation plans for people moving to Sweden. You must respond with ONLY valid JSON, no markdown fences, no preamble, matching exactly this schema:
{
  "intro": "2-3 sentence plain-language summary of their situation and what this plan covers",
  "steps": [
    {
      "order": 1,
      "title": "short step title",
      "timeframe": "e.g. Week 1-2",
      "description": "2-3 sentences in plain language explaining what to do and why it matters, written for someone unfamiliar with Sweden",
      "authority": "the relevant Swedish authority or organization name, e.g. Skatteverket, Migrationsverket, Forsakringskassan, a bank, or the local kommun",
      "tip": "one practical, specific tip that isn't obvious"
    }
  ]
}
Produce 6-9 steps covering the realistic dependency order for this specific person's situation (citizenship status and purpose of move affect the order and requirements a lot - e.g. non-EU citizens need a residence/work permit before most other steps, EU citizens do not). Be accurate about real Swedish processes: personnummer, BankID, opening a bank account, registering with Forsakringskassan, healthcare (region-specific vardcentral registration), tax registration, and any permit-specific steps. Do not invent fake requirements. Keep descriptions concise and practical, not generic filler.

IMPORTANT: Keep every "description" to at most 2 short sentences and every "tip" to at most 1 short sentence, regardless of language. This is critical when writing in non-Latin scripts (Hindi, Arabic, Ukrainian, etc.) where the same content takes more space - brevity ensures the full response fits and is not cut off.

Write all "intro", "title", "description", and "tip" text in ${outputLanguage}. Keep the "authority" field values in their original Swedish form (e.g. "Skatteverket", "Migrationsverket", "Forsakringskassan") since those are the real names people will encounter, even when the rest of the plan is in ${outputLanguage}.`;

  const userMessage = `My situation: I am a ${citizenship}, moving to Sweden for ${purpose}, settling in ${city}. Build my personalized 90-day plan in ${outputLanguage}.`;

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
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(502).json({ error: data?.error?.message || 'Upstream API error' });
    }

    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    let cleaned = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        } catch (e2) {
          const truncated = data.stop_reason === 'max_tokens';
          console.error('Failed to parse model output as JSON (fallback also failed). stop_reason:', data.stop_reason, text);
          return res.status(502).json({
            error: truncated
              ? 'Response was cut off before finishing (ran out of length). Try again — this should be rarer now with a higher limit.'
              : 'Model did not return valid JSON',
            raw: text
          });
        }
      } else {
        console.error('Failed to parse model output as JSON:', text);
        return res.status(502).json({ error: 'Model did not return valid JSON', raw: text });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error generating plan' });
  }
}
