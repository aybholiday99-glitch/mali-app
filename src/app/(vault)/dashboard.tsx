import React from 'react';
import { router } from 'expo-router';
import { DashboardScreen } from '../../screens/DashboardScreen';
import { useVaultActions } from '../../navigation/VaultActions';
import { pathForSection } from '../../navigation/routes';
export default function DashboardRoute() {
  const {openExport}=useVaultActions();
  return <DashboardScreen onNavigate={section=>router.navigate(pathForSection(section))} onOpenExportModal={openExport} />;
}
