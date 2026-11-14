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
    p_live_mode: live,
  });
  if (organizer.account_id && organizer.live_mode !== live) throw new HttpError(409, 'payment_mode_mismatch');
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
  const account = organizer.account_id
    ? await stripe.accounts.retrieve(organizer.account_id)
    : await stripe.accounts.create({
      type: 'standard',
      country: 'MX',
      capabilities: { card_payments: { requested: true } },
      metadata: { actv_organizer_id: organizer.organizer_id },
    }, { idempotencyKey: `actv-organizer-${organizer.organizer_id}` });
  if (account.type !== 'standard' || account.country !== 'MX') {
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
  const link = await stripe.accountLinks.create({
    account: account.id,
    type: 'account_onboarding',
    return_url: callback.href,
    refresh_url: refresh.href,
  });
  return { ...result, onboardingUrl: stripeRedirect(link.url, 'connect.stripe.com') };
}, true);

export default { fetch: organizerHandler };
