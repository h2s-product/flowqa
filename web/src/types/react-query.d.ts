import '@tanstack/react-query';

/** Metadata mutation yang dipakai aplikasi (lihat MutationCache di main.tsx). */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silentError?: boolean };
  }
}
