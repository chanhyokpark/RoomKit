import { Injectable } from '@nestjs/common';

/** A change confined to one asset; absent = anything may have changed. */
export interface AssetChange {
  assetId: string;
  removed?: boolean;
}

type AssetsChangedListener = (themeId: string, change?: AssetChange) => void;

/**
 * In-process fan-out for theme content changes (assets/tags). REST-layer
 * services publish here and the admin gateway relays to connected studios,
 * keeping the asset/tag modules free of a dependency on the gateway layer.
 */
@Injectable()
export class ThemeEventsService {
  private readonly assetListeners = new Set<AssetsChangedListener>();

  assetsChanged(themeId: string, change?: AssetChange): void {
    for (const listener of this.assetListeners) listener(themeId, change);
  }

  onAssetsChanged(listener: AssetsChangedListener): void {
    this.assetListeners.add(listener);
  }
}
