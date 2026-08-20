import type { Metadata } from 'next';

/**
 * Shared by every page whose URL is itself a bearer credential (the receipt
 * and verification links). A single export instead of copying this object
 * per page means a third such page inherits the policy by construction
 * rather than by whoever writes it remembering to retype it correctly.
 */
export const bearerTokenRobotsMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};
