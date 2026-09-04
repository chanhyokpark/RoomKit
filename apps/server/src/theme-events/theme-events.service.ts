import { Injectable } from '@nestjs/common';

type AssetsChangedListener = (themeId: string) => void;

/**
 * In-process fan-out for theme content changes (assets/tags). REST-layer
 * services publish here and the admin gateway relays to connected studios,
 * keeping the asset/tag modules free of a dependency on the gateway layer.
 */
@Injectable()
export class ThemeEventsService {
  private readonly assetListeners = new Set<AssetsChangedListener>();

  assetsChanged(themeId: string): void {
    for (const listener of this.assetListeners) listener(themeId);
  }

  onAssetsChanged(listener: AssetsChangedListener): void {
    this.assetListeners.add(listener);
  }
}
