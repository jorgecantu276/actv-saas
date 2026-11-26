-- Run as a database owner in the selected Supabase project.
-- Use true for live Stripe only. Change to false in the dedicated sandbox project.
begin read only;
set local statement_timeout = '10s';
select jsonb_pretty(actv_payments.payment_health(true)) as actv_payment_health;
select observed_minute,signals,metrics
from actv_payments.health_samples
where live_mode=true order by observed_minute desc limit 10;
select id,observed_at,signals,delivery_state,delivery_attempts,delivery_http_status
from actv_payments.health_incidents
where live_mode=true order by observed_at desc,id limit 20;
commit;
