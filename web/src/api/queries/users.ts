import { useMutation, useQuery } from '@tanstack/react-query';
import type { SaveUserRequest, UserAccount } from '@flowqa/shared';
import { http } from '../client';
import { keys } from './keys';
import { useInvalidate } from './shared';

export const useUsers = (enabled = true) =>
  useQuery({ queryKey: keys.users, queryFn: () => http.get<UserAccount[]>('/users'), enabled });

export function useSaveUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...user }: SaveUserRequest & { id?: string }) =>
      id ? http.put<UserAccount>(`/users/${id}`, user) : http.post<UserAccount>('/users', user),
    onSuccess: () => invalidate(keys.users),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/users/${id}`),
    onSuccess: () => invalidate(keys.users),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      http.post<void>('/account/password', body),
  });
}
