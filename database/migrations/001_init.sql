-- FOOTBALL AI PRO — initial schema (PostgreSQL 13+ / Supabase)

CREATE TABLE IF NOT EXISTS predictions (
  id               UUID PRIMARY KEY,
  match_id         TEXT        NOT NULL,
  competition_code TEXT        NOT NULL,
  home_team        TEXT        NOT NULL,
  away_team        TEXT        NOT NULL,
  kickoff          TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version    TEXT        NOT NULL,
  prob_home        DOUBLE PRECISION NOT NULL CHECK (prob_home BETWEEN 0 AND 1),
  prob_draw        DOUBLE PRECISION NOT NULL CHECK (prob_draw BETWEEN 0 AND 1),
  prob_away        DOUBLE PRECISION NOT NULL CHECK (prob_away BETWEEN 0 AND 1),
  prob_over25      DOUBLE PRECISION NOT NULL CHECK (prob_over25 BETWEEN 0 AND 1),
  prob_btts_yes    DOUBLE PRECISION NOT NULL CHECK (prob_btts_yes BETWEEN 0 AND 1),
  selected_market  TEXT        NOT NULL CHECK (selected_market IN ('1X2_HOME','1X2_DRAW','1X2_AWAY','OU25_OVER','OU25_UNDER','BTTS_YES','BTTS_NO')),
  selected_prob    DOUBLE PRECISION NOT NULL,
  odds_taken       DOUBLE PRECISION CHECK (odds_taken IS NULL OR odds_taken > 1),
  closing_odds     DOUBLE PRECISION CHECK (closing_odds IS NULL OR closing_odds > 1),
  demo             BOOLEAN     NOT NULL DEFAULT false,
  status           TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED','VOID')),
  home_goals       INTEGER,
  away_goals       INTEGER,
  settled_at       TIMESTAMPTZ,
  correct          BOOLEAN,
  profit           DOUBLE PRECISION,
  CONSTRAINT prediction_before_kickoff CHECK (created_at < kickoff),
  CONSTRAINT one_prediction_per_market UNIQUE (match_id, selected_market, model_version)
);

CREATE INDEX IF NOT EXISTS predictions_status_idx  ON predictions (status, kickoff);
CREATE INDEX IF NOT EXISTS predictions_created_idx ON predictions (created_at DESC);

-- Predictions are immutable: only settlement columns and closing odds (captured before kickoff)
-- may change after insert. This is enforced in the database, not just the application.
CREATE OR REPLACE FUNCTION predictions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.match_id IS DISTINCT FROM OLD.match_id
     OR NEW.kickoff IS DISTINCT FROM OLD.kickoff
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.prob_home IS DISTINCT FROM OLD.prob_home
     OR NEW.prob_draw IS DISTINCT FROM OLD.prob_draw
     OR NEW.prob_away IS DISTINCT FROM OLD.prob_away
     OR NEW.prob_over25 IS DISTINCT FROM OLD.prob_over25
     OR NEW.prob_btts_yes IS DISTINCT FROM OLD.prob_btts_yes
     OR NEW.selected_market IS DISTINCT FROM OLD.selected_market
     OR NEW.selected_prob IS DISTINCT FROM OLD.selected_prob
     OR NEW.odds_taken IS DISTINCT FROM OLD.odds_taken THEN
    RAISE EXCEPTION 'predictions are immutable once recorded';
  END IF;
  IF NEW.closing_odds IS DISTINCT FROM OLD.closing_odds AND now() >= OLD.kickoff THEN
    RAISE EXCEPTION 'closing odds can only be captured before kickoff';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS predictions_immutable_trg ON predictions;
CREATE TRIGGER predictions_immutable_trg BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION predictions_immutable();

-- Optional server-side cache of provider responses (useful on serverless to share across instances)
CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key  TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_cache_expiry_idx ON provider_cache (expires_at);

-- Supabase hardening: tables are written only by the server (table owner, which bypasses RLS).
-- Enabling RLS with no policies blocks the public anon/authenticated REST roles.
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_cache ENABLE ROW LEVEL SECURITY;
