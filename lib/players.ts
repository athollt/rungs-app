export type PlayerStatus = "ACTIVE" | "REMOVED";

export interface PlayerRecord {
  id: string;
  name: string;
  status: PlayerStatus;
}

export interface PlayerStore {
  findByNameInsensitive(name: string): Promise<PlayerRecord | null>;
  create(name: string): Promise<PlayerRecord>;
  updateName(id: string, name: string): Promise<PlayerRecord>;
  updateStatus(id: string, status: PlayerStatus): Promise<PlayerRecord>;
}

export type PlayerResult =
  | { ok: true; player: PlayerRecord }
  | { ok: false; error: string };

export async function createPlayer(
  name: string,
  store: PlayerStore,
): Promise<PlayerResult> {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, error: "Name is required." };
  }
  const existing = await store.findByNameInsensitive(trimmed);
  if (existing) {
    return { ok: false, error: "A player with that name already exists." };
  }
  const player = await store.create(trimmed);
  return { ok: true, player };
}

export async function updatePlayerName(
  id: string,
  name: string,
  store: PlayerStore,
): Promise<PlayerResult> {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, error: "Name is required." };
  }
  const existing = await store.findByNameInsensitive(trimmed);
  if (existing && existing.id !== id) {
    return { ok: false, error: "A player with that name already exists." };
  }
  const player = await store.updateName(id, trimmed);
  return { ok: true, player };
}

export type ResolveResult =
  | { ok: true; playerId: string }
  | { ok: false; error: string };

// The subset of PlayerStore that name resolution needs. Narrowing the param
// lets the shared session-intake store (which only carries findByName + create)
// call this without having to implement the full PlayerStore.
export type PlayerNameResolver = Pick<
  PlayerStore,
  "findByNameInsensitive" | "create"
>;

// Resolve an on-the-fly player name to a player id: reuse an existing player
// whose name matches case-insensitively, else create one. This is what session
// submit uses for slots typed as a "new" player, so a name that already exists
// is reused rather than duplicated.
export async function resolvePlayerName(
  name: string,
  store: PlayerNameResolver,
): Promise<ResolveResult> {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { ok: false, error: "Name is required." };
  }
  const existing = await store.findByNameInsensitive(trimmed);
  if (existing) {
    return { ok: true, playerId: existing.id };
  }
  const player = await store.create(trimmed);
  return { ok: true, playerId: player.id };
}

export async function updatePlayerStatus(
  id: string,
  status: PlayerStatus,
  store: PlayerStore,
): Promise<PlayerResult> {
  const player = await store.updateStatus(id, status);
  return { ok: true, player };
}
