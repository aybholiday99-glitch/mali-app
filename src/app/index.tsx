import React from 'react';
import { Redirect } from 'expo-router';
import { useMali } from '../context/MaliContext';
import { canEnterVault } from '../navigation/routes';
export default function IndexRoute() {
  const {currentUser,isLoading,authCleanupPending}=useMali();
  return <Redirect href={canEnterVault(currentUser,isLoading,authCleanupPending)?'/dashboard':'/sign-in'} />;
}
