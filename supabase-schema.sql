-- Run this entire file in Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → paste → Run

-- Profile (single row, id=1)
create table if not exists profile (
  id int primary key default 1,
  name text,
  age int,
  height text,
  weight_lbs numeric,
  goal text,
  phase text default 'athletic_hypertrophy',
  phase_start date default current_date,
  preferences jsonb default '{}',
  onboarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Weekly training plans
create table if not exists weekly_plans (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  days jsonb not null,
  phase text,
  phase_week int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Daily workout logs
create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  sleep_hours numeric,
  energy_am int,
  morning_done boolean default false,
  morning_type text,
  morning_feel int,
  morning_notes text,
  pm_exercises jsonb default '[]',
  pm_type text,
  pm_feel int,
  pm_notes text,
  overall_feel int,
  soreness jsonb default '{}',
  adjustment_note text,
  week_adjusted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Weekly meal plans
create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  days jsonb not null,
  grocery_list jsonb default '[]',
  created_at timestamptz default now()
);

-- Disable RLS for personal single-user app
alter table profile disable row level security;
alter table weekly_plans disable row level security;
alter table daily_logs disable row level security;
alter table meal_plans disable row level security;
