import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pzzxmpdwtyhsmjwtapln.supabase.co';

export const config = {
  api: { bodyParser: false }
};

function readRawBody(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    readable.on('data', (chunk) => {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      );
    });

    readable.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    readable.on('error', reject);
  });
}

function planFromAmount(amountCents) {
  if (amountCents === 4900) return 'starter';
  if (amountCents === 49000) return 'starter';
  if (amountCents === 14900) return 'pro';
  if (amountCents === 149000) return 'pro';

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Método não permitido');
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecret || !webhookSecret || !serviceKey) {
    console.error('Variáveis de ambiente ausentes');

    return res.status(500).json({
      error: 'Configuração ausente no servidor'
    });
  }

  const stripe = new Stripe(stripeSecret);

  const supabase = createClient(
    SUPABASE_URL,
    serviceKey
  );

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({
        error: 'Stripe-Signature ausente'
      });
    }

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );

    console.log('EVENTO RECEBIDO:', event.type);

    // ==========================================
    // PAGAMENTO CONCLUÍDO
    // ==========================================

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('CHECKOUT:', session.id);
      console.log('USER ID:', session.client_reference_id);
      console.log('VALOR:', session.amount_total);

      const userId = session.client_reference_id;

      if (!userId) {
        console.error('client_reference_id não encontrado');

        return res.status(400).json({
          error: 'client_reference_id não encontrado'
        });
      }

      const fullSession =
        await stripe.checkout.sessions.retrieve(
          session.id,
          {
            expand: ['line_items.data.price']
          }
        );

      const price =
        fullSession.line_items?.data?.[0]?.price;

      const amount = price?.unit_amount;

      console.log('VALOR DO PRICE:', amount);

      const plan = planFromAmount(amount);

      if (!plan) {
        console.error('Plano não identificado:', amount);

        return res.status(400).json({
          error: 'Plano não identificado',
          amount
        });
      }

      console.log('PLANO:', plan);

      const { data, error } =
        await supabase
          .from('profiles')
          .upsert({
            id: userId,
            plan,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            subscription_status: 'active',
            updated_at: new Date().toISOString()
          })
          .select();

      if (error) {
        console.error(
          'ERRO SUPABASE:',
          error
        );

        return res.status(500).json({
          error: 'Erro ao atualizar o Supabase',
          details: error.message,
          code: error.code
        });
      }

      console.log(
        'PROFILE ATUALIZADO:',
        data
      );
    }

    // ==========================================
    // ASSINATURA ALTERADA/CANCELADA
    // ==========================================

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object;

      const status = subscription.status;

      console.log(
        'ASSINATURA:',
        subscription.id,
        status
      );

      const { data: profile, error: findError } =
        await supabase
          .from('profiles')
          .select('id')
          .eq(
            'stripe_subscription_id',
            subscription.id
          )
          .maybeSingle();

      if (findError) {
        console.error(
          'ERRO AO PROCURAR PROFILE:',
          findError
        );

        return res.status(500).json({
          error: 'Erro ao procurar usuário',
          details: findError.message
        });
      }

      if (profile) {
        const isActive =
          status === 'active' ||
          status === 'trialing';

        const updateData = {
          subscription_status: status,
          updated_at: new Date().toISOString()
        };

        if (!isActive) {
          updateData.plan = 'free';
        }

        const { error: updateError } =
          await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', profile.id);

        if (updateError) {
          console.error(
            'ERRO AO ATUALIZAR PROFILE:',
            updateError
          );

          return res.status(500).json({
            error: 'Erro ao atualizar assinatura',
            details: updateError.message
          });
        }
      }
    }

    return res.status(200).json({
      received: true
    });

  } catch (err) {
    console.error(
      'ERRO NO WEBHOOK:',
      err
    );

    return res.status(500).json({
      error: err.message
    });
  }
}
