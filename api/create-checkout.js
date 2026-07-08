export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tier, origin } = req.body || {};
  if (!tier || !origin) {
    return res.status(400).json({ error: 'Missing tier or origin' });
  }

  const params = new URLSearchParams();
  params.append('success_url', `${origin}/?session_id={CHECKOUT_SESSION_ID}&paid=true`);
  params.append('cancel_url', `${origin}/?canceled=true`);

  if (tier === 'onetime') {
    params.append('mode', 'payment');
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'sek');
    params.append('line_items[0][price_data][unit_amount]', '29900');
    params.append('line_items[0][price_data][product_data][name]', 'Dag Ett — First 90 Days');
    params.append('line_items[0][price_data][product_data][description]', 'Personalized 90-day relocation plan plus unlimited AI chat during your first 90 days.');
  } else if (tier === 'subscription') {
    params.append('mode', 'subscription');
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'sek');
    params.append('line_items[0][price_data][unit_amount]', '5900');
    params.append('line_items[0][price_data][recurring][interval]', 'month');
    params.append('line_items[0][price_data][product_data][name]', 'Dag Ett — Ongoing Support');
    params.append('line_items[0][price_data][product_data][description]', 'Continued chat access, deadline reminders, and rule-change alerts.');
  } else {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', data);
      return res.status(502).json({ error: data?.error?.message || 'Stripe error' });
    }

    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error creating checkout session' });
  }
}
