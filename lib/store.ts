import "server-only";

import { Redis } from "@upstash/redis";
import type { AppState } from "./types";

const STATE_KEY = "mkqMerch:state";

const EMPTY_STATE: AppState = { events: [], activeEventId: null };

function getClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKENが設定されていません。.env.localに設定してください。"
    );
  }
  return new Redis({ url, token });
}

export async function getState(): Promise<AppState> {
  const redis = getClient();
  const state = await redis.get<AppState>(STATE_KEY);
  return state ?? EMPTY_STATE;
}

/** Overwrites the whole shared state. Every viewer's save sends the full
 * document (same model as the client's previous localStorage save) --
 * simple last-write-wins, no per-field merge. Fine at this scale (one
 * merch table, a handful of staff); a true multi-writer merge is not
 * worth the complexity here. */
export async function setState(state: AppState): Promise<void> {
  const redis = getClient();
  await redis.set(STATE_KEY, state);
}
