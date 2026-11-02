// Unit tests run server modules outside Next's server bundle, where the real
// `server-only` package throws on import. The Vitest preset aliases
// `server-only` to this empty module.
export {}
