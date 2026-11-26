import { appOrigin, body, handler, HttpError, liveMode, operator, rpc, uuid } from '../_shared/http.ts';
import { accountStatus, stripeClient, stripeRedirect } from '../_shared/stripe.ts';

interface OrganizerContext {
  organizer_id: string;
  account_id: string | null;
  live_mode: boolean;
  online_enabled: boolean;
  slug: string;
  event_name: string;
}

export const organizerHandler = handler('actv-organizer-connect', async (request) => {
  const userId = await operator(request);
  const input = await body(request);
  if (input.action !== 'onboard' && input.action !== 'status') throw new HttpError(400, 'invalid_action');
  const eventId = uuid(input.eventId);
  const live = liveMode();
  const organizer = await rpc<OrganizerContext>('actv_organizer', {
    p_operator: userId,
    p_event_id: eventId,
  });
  if (organizer.live_mode !== live) throw new HttpError(409, 'payment_mode_mismatch');
  if (!organizer.account_id && input.action === 'status') {
    return {
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      ready: false,
      onlineEnabled: organizer.online_enabled,
      slug: organizer.slug,
      eventName: organizer.event_name,
    };
  }

  const stripe = stripeClient();
  let accountId = organizer.account_id;
  if (!accountId) {
    const created = await stripe.v2.core.accounts.create({
      dashboard: 'full',
      identity: { country: 'MX' },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      metadata: { actv_organizer_id: organizer.organizer_id },
    }, { idempotencyKey: `actv-organizer-${organizer.organizer_id}` });
    if (created.livemode !== live) throw new HttpError(409, 'payment_mode_mismatch');
    accountId = created.id;
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new HttpError(409, 'stripe_account_unavailable');

  // Stripe exposes a v1 view of v2 merchant accounts, including the flags used by account.updated.
  const account = await stripe.accounts.retrieve(accountId);
  if (account.id !== accountId || account.type !== 'standard' || account.country !== 'MX') {
    throw new HttpError(409, 'stripe_account_unavailable');
  }

  const status = accountStatus(account);
  const updated = await rpc<OrganizerContext>('actv_set_account', {
    p_operator: userId,
    p_event_id: eventId,
    p_account_id: account.id,
    p_live_mode: live,
    p_ready: status.ready,
  });
  const result = {
    accountId: account.id,
    ...status,
    onlineEnabled: updated.online_enabled,
    slug: updated.slug,
    eventName: updated.event_name,
  };
  if (input.action === 'status' || status.ready) return result;

  const callback = new URL('/organizadores', appOrigin());
  callback.searchParams.set('evento', eventId);
  const refresh = new URL(callback);
  refresh.searchParams.set('reanudar', '1');
  const link = await stripe.v2.core.accountLinks.create({
    account: account.id,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { return_url: callback.href, refresh_url: refresh.href },
    },
  });
  if (link.livemode !== live) throw new HttpError(409, 'payment_mode_mismatch');
  if (link.account !== account.id) throw new HttpError(409, 'stripe_account_unavailable');
  return { ...result, onboardingUrl: stripeRedirect(link.url, 'accounts.stripe.com', 'connect.stripe.com') };
}, true);

export default { fetch: organizerHandler };
