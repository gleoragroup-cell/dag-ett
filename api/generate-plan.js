const RATE_LIMIT_MAX = 8;          // max plan generations per IP per window
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

async function checkRateLimit(ip) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return { limited: false, configured: false };
  }
  try {
    const key = `ratelimit:plan:${ip}`;
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
    return res.status(429).json({ error: 'Too many plan requests from this connection. Please wait a while and try again.' });
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

FACTUAL GROUND TRUTH - follow these precisely, they come from official Migrationsverket and Skatteverket guidance:
- Nordic citizens (Denmark, Finland, Norway, Iceland): need NO right-of-residence proof and NO residence permit at all. They can register directly with Skatteverket for folkbokforing/personnummer.
- EU/EEA citizens: do NOT apply for or receive a "residence permit" (uppehallstillstand). Instead they have "uppehallsratt" (right of residence) automatically if working, self-employed, studying, or self-sufficient - this is shown as evidence to Skatteverket (e.g. employment contract) when registering for folkbokforing, not approved by Migrationsverket. If planning to stay 1+ year, they register with Skatteverket and visit a servicekontor for ID verification.
- Swiss citizens are a special case: not EU/EEA, but do not need a work permit; they do need a residence permit if staying more than 3 months. If the person indicates Swiss citizenship, treat this as its own case rather than standard "Non-EU".
- Non-EU/EEA citizens joining an EU/EES family member: apply for "uppehallskort" (residence card) from Migrationsverket if staying more than 3 months - this is a different, typically faster and fee-free process compared to a standard residence permit.
- Non-EU/EEA citizens on standard work permits, study permits, or joining a non-EU/EES or Swedish family member (outside the EU free-movement rules): need "uppehallstillstand" (residence permit) approved by Migrationsverket BEFORE most other steps, including folkbokforing.
- For family reunification cases (joining a partner/family member in Sweden who is not an EU/EES citizen exercising free movement): mention that the sponsoring person in Sweden typically needs to meet a "forsorjningskrav" (maintenance/income requirement) to show they can support the family member - this is a commonly overlooked real requirement, include it as a step or note when relevant.
- Work permit rules changed in June 2026 (new salary thresholds, mandatory comprehensive health insurance, minimum pay levels for seasonal/ICT work). Do NOT state specific salary or fee figures, since these change - instead advise the person to check the current exact figures on migrationsverket.se.
- Do NOT include Arbetsformedlingens etableringsprogram (the establishment program) as a step unless the situation is specifically asylum-related or refugee/protection-status residency. It does not apply to EU/EEA citizens, Nordic citizens, standard work-permit holders, students, or most family-reunification cases.
- Only include steps genuinely relevant to the specific citizenship status and purpose given - do not pad the plan with steps for a different migrant category, and do not describe EU/EEA citizens as needing permit "approval".

Produce 6-9 steps covering the realistic dependency order for this specific person's situation. Be accurate about real Swedish processes: personnummer, BankID, opening a bank account, registering with Forsakringskassan, healthcare (region-specific vardcentral registration), tax registration, and any permit-specific steps. Do not invent fake requirements. Keep descriptions concise and practical, not generic filler.

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
              ? 'Response was cut off before finishing (ran out of length). Try again.'
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
