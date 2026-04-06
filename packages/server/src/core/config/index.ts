/**
 * Configuration loader for centralized application config management
 */

import inviteCodesData from './invite-codes.json';

export interface AppConfig {
  inviteCodes: string[];
  frontendUrl: string;
  port: number;
}

/**
 * Get application configuration
 */
export function getAppConfig(): AppConfig {
  return {
    inviteCodes: inviteCodesData as string[],
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    port: Number(process.env.PORT || 3000),
  };
}

/**
 * Export invite codes for backward compatibility
 */
export const inviteCodes = inviteCodesData as string[];
