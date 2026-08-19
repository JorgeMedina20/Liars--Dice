// Reemplazo de window.storage (API exclusiva de los artefactos de Claude)
// usando Upstash Redis, vía su API REST — capa gratuita.
//
// Implementa la misma forma que window.storage: get / set / delete / list,
// todo con shared=true (este juego solo usa almacenamiento compartido).

const REST_URL = import.meta.env.VITE_UPSTASH_REDIS_REST_URL;
const REST_TOKEN = import.meta.env.VITE_UPSTASH_REDIS_REST_TOKEN;

async function redisFetch(path, options = {}) {
  const res = await fetch(`${REST_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Upstash error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export const storage = {
  async get(key) {
    const data = await redisFetch(`/get/${encodeURIComponent(key)}`);
    if (data.result === null || data.result === undefined) return null;
    return { key, value: data.result, shared: true };
  },

  async set(key, value) {
    await redisFetch(`/set/${encodeURIComponent(key)}`, {
      method: "POST",
      body: value,
    });
    return { key, value, shared: true };
  },

  async delete(key) {
    await redisFetch(`/del/${encodeURIComponent(key)}`, { method: "POST" });
    return { key, deleted: true, shared: true };
  },

  async list(prefix = "") {
    const pattern = prefix ? `${prefix}*` : "*";
    const data = await redisFetch(`/keys/${encodeURIComponent(pattern)}`);
    return { keys: data.result || [], prefix, shared: true };
  },
};
