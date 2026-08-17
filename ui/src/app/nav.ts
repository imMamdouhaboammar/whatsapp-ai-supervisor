import type { ComponentProps } from 'react';
import { Icon } from '../components/Icon';

export type RouteKey = 'overview' | 'tenants' | 'whatsapp' | 'inbox' | 'actions' | 'audit' | 'settings';

export const navItems: Array<{ key: RouteKey; label: string; icon: ComponentProps<typeof Icon>['name'] }> = [
  { key: 'overview', label: 'Overview', icon: 'overview' },
  { key: 'tenants', label: 'Tenants', icon: 'tenants' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'actions', label: 'Actions', icon: 'actions' },
  { key: 'audit', label: 'Audit', icon: 'audit' },
  { key: 'settings', label: 'Settings', icon: 'settings' }
];

export function routeFromHash(): RouteKey {
  const key = location.hash.replace(/^#\/?/, '') as RouteKey;
  return navItems.some((item) => item.key === key) ? key : 'overview';
}
