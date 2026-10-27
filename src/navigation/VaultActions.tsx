import { createContext, useContext } from 'react';
const VaultActions = createContext<{openExport:()=>void} | null>(null);
export const VaultActionsProvider = VaultActions.Provider;
export function useVaultActions() {
  const actions=useContext(VaultActions);
  if (!actions) throw new Error('Vault screen requires the authenticated shell.');
  return actions;
}
