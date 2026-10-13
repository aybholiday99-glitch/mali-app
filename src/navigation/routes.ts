export const VAULT_ROUTES = {
  dashboard: '/dashboard', accounts: '/accounts', deals: '/deals',
  contacts: '/contacts', expenses: '/expenses', procedures: '/procedures',
} as const;
export type VaultSection = keyof typeof VAULT_ROUTES;
export function pathForSection(section: string) {
  return Object.hasOwn(VAULT_ROUTES,section) ? VAULT_ROUTES[section as VaultSection] : VAULT_ROUTES.dashboard;
}
export function sectionFromPath(pathname: string): VaultSection {
  return (Object.entries(VAULT_ROUTES).find(([,href])=>href === pathname)?.[0] || 'dashboard') as VaultSection;
}
export function canEnterVault(user: {id:string} | null, isLoading: boolean, authCleanupPending: boolean) {
  return Boolean(user?.id && !isLoading && !authCleanupPending);
}
