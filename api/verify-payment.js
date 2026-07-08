export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query || {};
  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', data);
      return res.status(502).json({ error: data?.error?.message || 'Stripe error' });
    }

    const paid = data.payment_status === 'paid' || data.status === 'complete';
    return res.status(200).json({ paid, mode: data.mode });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error verifying payment' });
  }
}
