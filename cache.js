const store = new Map();

function now() {
  return Date.now();
}

function memoizeAsync(key, ttlMs, factory) {
  const cached = store.get(key);
  if (cached && cached.expiresAt > now()) {
    return cached.promise;
  }

  const promise = Promise.resolve()
    .then(factory)
    .then((result) => {
      if (Array.isArray(result) && result.length === 0) {
        store.delete(key);
      }
      return result;
    })
    .catch((error) => {
      store.delete(key);
      throw error;
    });

  store.set(key, {
    promise,
    expiresAt: now() + ttlMs
  });

  return promise;
}

function clearExpired() {
  const cutoff = now();
  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= cutoff) store.delete(key);
  }
}

module.exports = {
  memoizeAsync,
  clearExpired
};
