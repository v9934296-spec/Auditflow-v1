-- Phase 2 recheck integrity.
-- Adds one finding status. Historical rows keep the value they already have.
-- Policies stay owner-scoped; this migration does not rewrite findings, audits, or grants.

alter type public.finding_change add value if not exists 'not_retested';
