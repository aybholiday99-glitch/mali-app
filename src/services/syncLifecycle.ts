import * as ReactNative from 'react-native';

/** Foreground work only: no claim of OS-scheduled background execution. */
export function subscribeSyncLifecycle(setForeground: (active: boolean) => void, reconnect: () => void) {
  const appState = ReactNative.AppState;
  setForeground(!appState?.currentState || appState.currentState === 'active');
  const subscription = appState?.addEventListener('change', state => {
    const active = state === 'active'; setForeground(active); if (active) reconnect();
  });
  const online = () => reconnect();
  if (typeof window !== 'undefined') window.addEventListener('online', online);
  return () => { subscription?.remove(); if (typeof window !== 'undefined') window.removeEventListener('online', online); };
}
