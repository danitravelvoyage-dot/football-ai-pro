// Prediction storage. PostgreSQL (e.g. Supabase free tier) when DATABASE_URL is set,
// otherwise a local JSON file store for development. Both enforce immutability rules.
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { env } from "@/lib/env";
import type { StoredPrediction } from "@/types";

export type NewPrediction = Omit<StoredPrediction, "id" | "createdAt" | "status" | "homeGoals" | "awayGoals" | "settledAt" | "correct" | "profit" | "closingOdds">;

export class DuplicatePredictionError extends Error {}
export class KickoffPassedError extends Error {}

export interface PredictionStore {
  readonly kind: "postgres" | "file";
  insert(p: NewPrediction): Promise<StoredPrediction>;
  list(limit?: number): Promise<StoredPrediction[]>;
  pending(): Promise<StoredPrediction[]>;
  settle(id: string, homeGoals: number, awayGoals: number, correct: boolean, profit: number | null): Promise<void>;
  voidPrediction(id: string): Promise<void>;
  setClosingOdds(id: string, odds: number): Promise<void>;
}

// ---------------- PostgreSQL ----------------
type Row = Record<string, unknown>;
function fromRow(r: Row): StoredPrediction {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return {
    id: r.id as string, matchId: r.match_id as string, competitionCode: r.competition_code as string,
    homeTeam: r.home_team as string, awayTeam: r.away_team as string, kickoff: iso(r.kickoff)!, createdAt: iso(r.created_at)!,
    modelVersion: r.model_version as string, probHome: r.prob_home as number, probDraw: r.prob_draw as number, probAway: r.prob_away as number,
    probOver25: r.prob_over25 as number, probBttsYes: r.prob_btts_yes as number, selectedMarket: r.selected_market as StoredPrediction["selectedMarket"],
    selectedProb: r.selected_prob as number, oddsTaken: r.odds_taken as number | null, closingOdds: r.closing_odds as number | null, demo: r.demo as boolean,
    status: r.status as StoredPrediction["status"], homeGoals: r.home_goals as number | null, awayGoals: r.away_goals as number | null,
    settledAt: iso(r.settled_at), correct: r.correct as boolean | null, profit: r.profit as number | null,
  };
}

class PostgresStore implements PredictionStore {
  readonly kind = "postgres" as const;
  private pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  }
  async insert(p: NewPrediction) {
    if (Date.now() >= new Date(p.kickoff).getTime()) throw new KickoffPassedError();
    try {
      const r = await this.pool.query(
        `INSERT INTO predictions (id, match_id, competition_code, home_team, away_team, kickoff, model_version, prob_home, prob_draw, prob_away,
          prob_over25, prob_btts_yes, selected_market, selected_prob, odds_taken, demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [randomUUID(), p.matchId, p.competitionCode, p.homeTeam, p.awayTeam, p.kickoff, p.modelVersion, p.probHome, p.probDraw, p.probAway,
          p.probOver25, p.probBttsYes, p.selectedMarket, p.selectedProb, p.oddsTaken, p.demo],
      );
      return fromRow(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new DuplicatePredictionError();
      if ((e as { code?: string }).code === "23514") throw new KickoffPassedError();
      throw e;
    }
  }
  async list(limit = 500) {
    const r = await this.pool.query("SELECT * FROM predictions ORDER BY created_at DESC LIMIT $1", [limit]);
    return r.rows.map(fromRow);
  }
  async pending() {
    const r = await this.pool.query("SELECT * FROM predictions WHERE status = 'PENDING' AND kickoff < now() ORDER BY kickoff LIMIT 50");
    return r.rows.map(fromRow);
  }
  async settle(id: string, h: number, a: number, correct: boolean, profit: number | null) {
    await this.pool.query(
      "UPDATE predictions SET status='SETTLED', home_goals=$2, away_goals=$3, correct=$4, profit=$5, settled_at=now() WHERE id=$1 AND status='PENDING'",
      [id, h, a, correct, profit],
    );
  }
  async voidPrediction(id: string) {
    await this.pool.query("UPDATE predictions SET status='VOID', settled_at=now() WHERE id=$1 AND status='PENDING'", [id]);
  }
  async setClosingOdds(id: string, odds: number) {
    await this.pool.query("UPDATE predictions SET closing_odds=$2 WHERE id=$1 AND kickoff > now()", [id, odds]);
  }
}

// ---------------- File store (development / zero-config) ----------------
class FileStore implements PredictionStore {
  readonly kind = "file" as const;
  private file: string;
  private lock: Promise<unknown> = Promise.resolve();
  constructor() {
    const dir = process.env.VERCEL ? "/tmp/football-ai-pro" : path.join(process.cwd(), ".data");
    this.file = path.join(dir, "predictions.json");
  }
  private async read(): Promise<StoredPrediction[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as StoredPrediction[];
    } catch {
      return [];
    }
  }
  private async write(all: StoredPrediction[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 1));
    await fs.rename(tmp, this.file);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }
  insert(p: NewPrediction) {
    return this.serial(async () => {
      if (Date.now() >= new Date(p.kickoff).getTime()) throw new KickoffPassedError();
      const all = await this.read();
      if (all.some((x) => x.matchId === p.matchId && x.selectedMarket === p.selectedMarket && x.modelVersion === p.modelVersion))
        throw new DuplicatePredictionError();
      const rec: StoredPrediction = {
        ...p, id: randomUUID(), createdAt: new Date().toISOString(), status: "PENDING", closingOdds: null,
        homeGoals: null, awayGoals: null, settledAt: null, correct: null, profit: null,
      };
      all.push(rec);
      await this.write(all);
      return rec;
    });
  }
  async list(limit = 500) {
    return (await this.read()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async pending() {
    return (await this.read()).filter((p) => p.status === "PENDING" && new Date(p.kickoff).getTime() < Date.now()).slice(0, 50);
  }
  private update(id: string, fn: (p: StoredPrediction) => void) {
    return this.serial(async () => {
      const all = await this.read();
      const p = all.find((x) => x.id === id);
      if (p) {
        fn(p);
        await this.write(all);
      }
    });
  }
  settle(id: string, h: number, a: number, correct: boolean, profit: number | null) {
    return this.update(id, (p) => {
      if (p.status !== "PENDING") return;
      Object.assign(p, { status: "SETTLED", homeGoals: h, awayGoals: a, correct, profit, settledAt: new Date().toISOString() });
    });
  }
  voidPrediction(id: string) {
    return this.update(id, (p) => {
      if (p.status === "PENDING") Object.assign(p, { status: "VOID", settledAt: new Date().toISOString() });
    });
  }
  setClosingOdds(id: string, odds: number) {
    return this.update(id, (p) => {
      if (Date.now() < new Date(p.kickoff).getTime()) p.closingOdds = odds;
    });
  }
}

let store: PredictionStore | null = null;
export function getStore(): PredictionStore {
  if (!store) store = env.databaseUrl ? new PostgresStore(env.databaseUrl) : new FileStore();
  return store;
}
