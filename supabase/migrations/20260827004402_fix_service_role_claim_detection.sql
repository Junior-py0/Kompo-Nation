begin;

do $do$
declare
  fn regprocedure;
  def text;

  old_expression text :=
    'current_setting(''request.jwt.claim.role'',true)';

  new_expression text :=
    'coalesce(
       nullif(
         current_setting(''request.jwt.claims'', true),
         ''''
       )::jsonb ->> ''role'',
       current_setting(''request.jwt.claim.role'', true)
     )';
begin
  foreach fn in array array[
    'public.reserve_vendor_liability_recoveries(uuid)'::regprocedure,
    'public.settle_vendor_liability_recoveries_by_reference(text)'::regprocedure,
    'public.finalize_return_payment(text,bigint,jsonb)'::regprocedure
  ]
  loop

    select pg_get_functiondef(fn::oid)
    into def;

    if def is null then
      raise exception
        'Could not read function definition for %',
        fn;
    end if;

    if position(old_expression in def) = 0 then
      raise exception
        'Legacy JWT role expression was not found in %',
        fn;
    end if;

    def :=
      replace(
        def,
        old_expression,
        new_expression
      );

    execute def;

    raise notice
      'Updated JWT role detection in %',
      fn;

  end loop;
end
$do$;

commit;
