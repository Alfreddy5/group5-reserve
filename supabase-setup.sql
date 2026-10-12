-- Run this in Supabase: SQL Editor > New query > Run
-- (Safe to run again: it only creates what is missing.)

create table if not exists slots (
  label  text primary key,
  status text not null default 'Available',   -- Available | Occupied (paying makes it Occupied)
  name   text                                 -- username of the person holding the slot
);
-- NEW: fee per hour for each slot (pesos)
alter table slots add column if not exists rate numeric not null default 20;

create table if not exists waiting (
  id         bigint generated always as identity primary key,
  name       text not null,   -- username of the person waiting
  created_at timestamptz default now()
);

create table if not exists users (
  username      text primary key,
  full_name     text not null,
  password_hash text not null,
  created_at    timestamptz default now()
);

-- NEW: reservations (one row per ticket)
create table if not exists reservations (
  id         bigint generated always as identity primary key,
  code       text unique not null,            -- ticket code shown to the user, e.g. PE-7K3Q9X
  slot       text not null,                   -- slot label
  username   text not null,
  hours      int  not null,
  fee        numeric not null,                -- hours x slot rate, in pesos
  method     text not null,                   -- GCash | Credit / Debit card
  paid       boolean not null default false,
  status     text not null default 'Occupied',  -- Occupied | Completed | Cancelled
  created_at timestamptz default now(),
  checkin_at timestamptz,                     -- when it became Occupied (payment time)
  done_at    timestamptz                      -- when checked out or cancelled
);

-- Allow the website (anon key) to read and write the tables.
-- Simple school project: not production-level security.
alter table slots        enable row level security;
alter table waiting      enable row level security;
alter table users        enable row level security;
alter table reservations enable row level security;

drop policy if exists "public slots"        on slots;
drop policy if exists "public waiting"      on waiting;
drop policy if exists "public users"        on users;
drop policy if exists "public reservations" on reservations;
create policy "public slots"        on slots        for all using (true) with check (true);
create policy "public waiting"      on waiting      for all using (true) with check (true);
create policy "public users"        on users        for all using (true) with check (true);
create policy "public reservations" on reservations for all using (true) with check (true);

-- Tidy up data from the earlier Reserved version (safe to run again)
update slots        set status = 'Occupied' where status = 'Reserved';
update reservations set status = 'Occupied' where status = 'Reserved';

-- Optional starter slots (VIP costs more)
insert into slots (label, rate) values ('A1',20),('A2',20),('A3',20),('A4',20),('A5',20),('B1',20),('B2',20),('B3',20),('VIP1',50),('VIP2',50)
on conflict do nothing;
