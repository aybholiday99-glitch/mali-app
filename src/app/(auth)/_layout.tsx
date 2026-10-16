import React from 'react';
import { Slot } from 'expo-router';
import { MaliAuthShell } from '../../navigation/MaliAuthShell';
export default function AuthLayout() { return <MaliAuthShell><Slot /></MaliAuthShell>; }
