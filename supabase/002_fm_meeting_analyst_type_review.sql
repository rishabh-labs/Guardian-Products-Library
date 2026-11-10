-- Guardian Product Library — update 2
-- Adds: fund manager meeting + transcript, analyst (fund owner), Equity/Debt,
-- PMS/AIF + AIF category, and "review again after N months" reminders.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

alter table public.products
  add column if not exists asset_class        text,                         -- 'Equity' | 'Debt'
  add column if not exists vehicle            text,                         -- 'PMS' | 'AIF'
  add column if not exists aif_category       text,                         -- 'Cat I' | 'Cat II' | 'Cat III' (AIF only)
  add column if not exists analyst            text not null default '',     -- who owned the analysis
  add column if not exists fm_meeting_date    date,
  add column if not exists fm_transcript      text not null default '',
  add column if not exists review_again       boolean not null default false,
  add column if not exists review_months      smallint,
  add column if not exists review_due         date,
  add column if not exists reminder_sent_at   timestamptz;

do $$ begin
  alter table public.products add constraint products_asset_class_chk check (asset_class is null or asset_class in ('Equity','Debt'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_vehicle_chk check (vehicle is null or vehicle in ('PMS','AIF'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_aif_cat_chk check (
    aif_category is null or (vehicle = 'AIF' and aif_category in ('Cat I','Cat II','Cat III')));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_review_chk check (
    (review_again and review_months between 1 and 12 and review_due is not null) or not review_again);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_transcript_len check (char_length(fm_transcript) <= 200000);
exception when duplicate_object then null; end $$;

-- Carry over the old single "category" value into the new fields.
update public.products set vehicle = 'PMS' where vehicle is null and category = 'PMS';
update public.products set vehicle = 'AIF',
  aif_category = case category when 'AIF Cat I' then 'Cat I' when 'AIF Cat II' then 'Cat II' when 'AIF Cat III' then 'Cat III' end
  where vehicle is null and category like 'AIF Cat %';

-- Files can now be tagged as the fund manager meeting transcript.
alter table public.documents add column if not exists kind text not null default 'doc';
do $$ begin
  alter table public.documents add constraint documents_kind_chk check (kind in ('doc','transcript'));
exception when duplicate_object then null; end $$;

-- When someone changes the review date, a fresh reminder is due.
create or replace function public.products_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.reminder_sent_at := null;
    new.updated_by := auth.uid(); new.updated_at := now();
    return new;
  end if;
  new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  if new.review_due is distinct from old.review_due or new.review_again is distinct from old.review_again then
    new.reminder_sent_at := null;
  elsif auth.uid() is not null then
    new.reminder_sent_at := old.reminder_sent_at;     -- only the reminder job may mark a reminder as sent
  end if;
  if auth.uid() is not null then
    new.updated_by := auth.uid(); new.updated_at := now();
  else                                                -- the reminder job doesn't count as an edit
    new.updated_by := old.updated_by; new.updated_by_name := old.updated_by_name; new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
