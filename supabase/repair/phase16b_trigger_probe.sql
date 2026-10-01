-- =============================================================================
-- PHASE 16B — IMMUTABILITY TRIGGER PROBE. RUN THIS WHOLE FILE ON ITS OWN.
-- OPTIONAL, AND IT ENDS IN A DELIBERATE ERROR.
--
-- Ctrl+A, Ctrl+C, paste into the SQL editor, Run. Nothing here is commented
-- out and there is no other statement in the file.
--
-- This is split out of phase16b_audit_production.sql. It is separate because
-- it is the only WRITE in the whole audit, and it is built to discard itself.
--
-- The only honest way to prove the trigger still REFUSES is to try it. A DO
-- block is a single statement and therefore a single transaction, so the
-- `raise exception` at the end guarantees everything inside it is discarded —
-- including the UPDATE, in the case where the trigger has failed and the
-- UPDATE succeeded. That is the point: this cannot leave damage behind even
-- if it finds the worst possible answer.
--
-- You WILL see a red error. Read its message — that is the result.
-- Expect:  PROBE: the trigger refused = true
-- =============================================================================

do $$
declare
  v_id       uuid;
  v_refused  boolean := false;
  v_message  text := '(no attempt made)';
begin
  select id into v_id from public.challenge_days limit 1;
  if v_id is null then
    raise exception 'PROBE: no challenge_days row to test against';
  end if;
  begin
    update public.challenge_days set task_snapshot = '[]'::jsonb where id = v_id;
    v_message := 'THE UPDATE SUCCEEDED — the guarantee is gone';
  exception when others then
    v_refused := (sqlerrm = 'day snapshots are immutable');
    v_message := sqlerrm;
  end;
  raise exception 'PROBE: the trigger refused = % (%). Nothing was kept.',
    v_refused, v_message;
end $$;
