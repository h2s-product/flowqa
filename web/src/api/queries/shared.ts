import { useQueryClient } from '@tanstack/react-query';

/** Invalidasi beberapa query key sekaligus (key boleh berupa prefix). */
export function useInvalidate() {
  const client = useQueryClient();
  return (...queryKeys: readonly (readonly unknown[])[]) =>
    Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
