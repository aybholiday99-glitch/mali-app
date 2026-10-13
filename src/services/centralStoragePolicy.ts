/** Android/web customer finance must use the server-only provider after verified legacy migration.
 * The gate is deliberately OFF until the server RPC, customer migration screen and
 * deployment coordination are approved. Expo embeds EXPO_PUBLIC_* at build time.
 * NEVER set this flag true in production before the rollout gates pass.
 */
export const CENTRAL_SERVER_ONLY = process.env.EXPO_PUBLIC_MALI_CENTRAL_ONLY === 'true';
