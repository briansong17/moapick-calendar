-- Isolation regression: all fixture data is rolled back, even on an assertion failure.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.moa_accounts(username) values('moa_rls_fixture');
insert into public.moa_subscriptions(user_id,username) values('11111111-1111-4111-8111-111111111111','moa_rls_fixture');
insert into public.moa_analyses(id,owner_id,account,hash,status,metadata) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',null,'test-private','complete','{}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,'moa_rls_fixture','test-shared','complete','{}');
insert into public.moa_reviews(user_id,analysis_id,events) values('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.moa_analyses) then raise exception 'cross-user analysis leak'; end if;
 if exists(select 1 from public.moa_subscriptions) then raise exception 'cross-user subscription leak'; end if;
 if exists(select 1 from public.moa_reviews) then raise exception 'cross-user review leak'; end if;
 if has_table_privilege(current_user,'public.moa_google','SELECT') then raise exception 'token table exposed'; end if;
 if has_table_privilege(current_user,'public.moa_oauth','SELECT') then raise exception 'OAuth state exposed'; end if;
 if has_table_privilege(current_user,'public.moa_analyses','INSERT') then raise exception 'client write exposed'; end if;
 if has_function_privilege(current_user,'public.moa_take_limit(text,integer,integer)','EXECUTE') then raise exception 'budget bypass'; end if;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$begin
 if (select count(*) from public.moa_analyses)<>2 then raise exception 'owner/subscriber read failed'; end if;
 if (select count(*) from public.moa_reviews)<>1 then raise exception 'own review read failed'; end if;
end $$;
reset role;
rollback;
select 'PASS: cross-user reads, client writes, token access and budget bypass blocked; fixtures rolled back' as result;
