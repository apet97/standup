import type { Addon } from 'pumble-sdk/lib/core/services/Addon';
import type { AddonManifest } from 'pumble-sdk/lib/core/types/types';

// Global addon instance for use by other modules
let addonInstance: Addon<AddonManifest> | null = null;

export function getAddonInstance(): Addon<AddonManifest> | null {
  return addonInstance;
}

export function setAddonInstance(instance: Addon<AddonManifest>): void {
  addonInstance = instance;
}
