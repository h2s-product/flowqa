import { useMutation, useQuery } from '@tanstack/react-query';
import type { AppiumSettings, AppiumStatus, EmailSettings, EmailSettingsView } from '@flowqa/shared';
import { http } from '../client';
import { keys } from './keys';
import { useInvalidate } from './shared';

/** Pengaturan SMTP (khusus admin). Password selalu disamarkan. */
export const useEmailSettings = () =>
  useQuery({ queryKey: keys.emailSettings, queryFn: () => http.get<EmailSettingsView>('/settings/email') });

export function useSaveEmailSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (settings: EmailSettings) => http.put<EmailSettingsView>('/settings/email', settings),
    onSuccess: () => invalidate(keys.emailSettings, keys.notificationStatus),
  });
}

export function useResetEmailSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => http.delete<EmailSettingsView>('/settings/email'),
    onSuccess: () => invalidate(keys.emailSettings, keys.notificationStatus),
  });
}

/** Kirim email percobaan dengan isian form (belum perlu disimpan). */
export const useSendSettingsTestEmail = () =>
  useMutation({
    mutationFn: (body: { to: string[]; settings: EmailSettings }) =>
      http.post<{ sentTo: string[] }>('/settings/email/test', body),
  });

/* ---------------------------- Mobile (Appium) ---------------------------- */

export type AppiumSettingsView = AppiumSettings & { source: 'app' | 'default' };

/** Pengaturan server Appium (khusus admin). Kredensial di URL disamarkan. */
export const useAppiumSettings = () =>
  useQuery({
    queryKey: keys.appiumSettings,
    queryFn: () => http.get<AppiumSettingsView>('/settings/appium'),
  });

export function useSaveAppiumSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (settings: AppiumSettings) => http.put<AppiumSettingsView>('/settings/appium', settings),
    onSuccess: () => invalidate(keys.appiumSettings),
  });
}

export function useResetAppiumSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => http.delete<AppiumSettingsView>('/settings/appium'),
    onSuccess: () => invalidate(keys.appiumSettings),
  });
}

/** Cek koneksi ke Appium dengan isian form (belum perlu disimpan). */
export const useTestAppium = () =>
  useMutation({
    mutationFn: (settings?: AppiumSettings) => http.post<AppiumStatus>('/settings/appium/test', { settings }),
  });
