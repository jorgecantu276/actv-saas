-- A Stripe card refund can fail after initially reporting succeeded.
-- Preserve terminal failures against older notifications and recalculate folio validity.
create or replace function public.actv_record_adjustment(
  p_account_id text,p_live_mode boolean,p_reference text,p_kind text,p_payment_id text,p_amount bigint,p_currency text,p_state text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_order uuid;
  v_previous_state text;
begin
  if not exists(select 1 from actv_payments.accounts where account_id=p_account_id and live_mode=p_live_mode)
    or p_payment_id is null then return; end if;

  select id into v_order from actv_payments.orders
    where account_id=p_account_id and live_mode=p_live_mode and provider_payment_id=p_payment_id for update;

  if v_order is not null and p_kind='refund' and p_state in ('failed','canceled') then
    select state into v_previous_state from actv_payments.adjustments
    where account_id=p_account_id and live_mode=p_live_mode and reference=p_reference
      and kind=p_kind and payment_id=p_payment_id and amount=p_amount and currency=lower(p_currency);
  end if;

  insert into actv_payments.adjustments(account_id,live_mode,reference,kind,payment_id,amount,currency,state)
  values(p_account_id,p_live_mode,p_reference,p_kind,p_payment_id,p_amount,lower(p_currency),p_state)
  on conflict(account_id,live_mode,reference) do update set state=excluded.state
    where (adjustments.kind,adjustments.payment_id,adjustments.amount,adjustments.currency)=
          (excluded.kind,excluded.payment_id,excluded.amount,excluded.currency)
      and (
        adjustments.state=excluded.state
        or adjustments.state not in ('succeeded','failed','canceled','won','lost')
        or (adjustments.kind='refund' and adjustments.state='succeeded' and excluded.state in ('failed','canceled'))
      );

  if v_order is not null then
    if actv_payments.refresh_eligibility(v_order) and v_previous_state='succeeded' then
      -- A refund could have arrived before initial issuance, leaving no existing folios to restore.
      update actv_payments.orders set state='review' where id=v_order and state='voided';
      perform actv_payments.issue(v_order);
    end if;
  end if;
end $$;
