// ============================================================
// Tasklyn AI — Webhook do Stripe
// Recebe avisos do Stripe quando alguém paga, cancela, etc,
// e atualiza o plano do usuário no Supabase automaticamente.
//
// Precisa de TRÊS variáveis de ambiente no Vercel:
// - STRIPE_SECRET_KEY       (Stripe > Developers > API keys > Secret key)
// - STRIPE_WEBHOOK_SECRET   (gerada ao criar o webhook no Stripe, começa com whsec_)
// - SUPABASE_SERVICE_ROLE_KEY  (já configurada antes)
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pzzxmpdwtyhsmjwtapln.supabase.co';

// Desliga o processamento automático do corpo da requisição —
// precisamos do corpo "cru" pra verificar a assinatura do Stripe.
export const config = {
  api: { bodyParser: false }
};

function readRawBody(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// Descobre qual plano foi comprado com base no valor cobrado
// (evita precisar configurar IDs de preço manualmente)
function planFromAmount(amountCents) {
  if (amountCents === 4900) return 'starter';   // Starter mensal
  if (amountCents === 49000) return 'starter';  // Starter anual
  if (amountCents === 14900) return 'pro';      // Pro mensal
  if (amountCents === 149000) return 'pro';     // Pro anual
  return 'pro'; // padrão de segurança
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Método não permitido');
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecret || !webhookSecret || !serviceKey) {
    return res.status(500).send('Configuração ausente no servidor (chaves do Stripe ou Supabase).');
  }

  const stripe = new Stripe(stripeSecret);
  const supabase = createClient(SUPABASE_URL, serviceKey);

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Assinatura inválida: ${err.message}`);
  }

  try {
    // Alguém completou o pagamento
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;

      if (userId) {
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price']
        });
        const price = fullSession.line_items?.data?.[0]?.price;
        const plan = planFromAmount(price?.unit_amount);

        await supabase.from('profiles').upsert({
          id: userId,
          plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: 'active',
          updated_at: new Date().toISOString()
        });
      }
    }

    // Assinatura mudou de status (ex: cancelada, atrasada)
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const status = subscription.status;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_subscription_id', subscription.id)
        .maybeSingle();

      if (profile) {
        const isActive = status === 'active' || status === 'trialing';
        const updateData = {
          subscription_status: status,
          updated_at: new Date().toISOString()
        };
        if (!isActive) updateData.plan = 'free'; // cancelou/atrasou → volta pro free

        await supabase.from('profiles').update(updateData).eq('id', profile.id);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
