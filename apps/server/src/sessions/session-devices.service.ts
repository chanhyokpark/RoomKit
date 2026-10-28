import { Injectable } from '@nestjs/common';
import type {
  SessionDeviceStatus,
  SessionDevicesResponse,
  SessionResponse,
} from '@roomkit/shared';
import { ConnectionRegistry } from '../gateway/connection-registry';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';

/**
 * Live per-device diagnostics of one session (`GET /sessions/:id/devices`):
 * socket presence, detected component versions, the website/state the
 * runtime believes the device shows, and whether `eval` can target it. Built
 * for test tooling that has to tell "offline", "two windows", "no website"
 * and "helper not loaded yet" apart without the admin socket.
 */
@Injectable()
export class SessionDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectionRegistry,
    private readonly runtime: SessionRuntimeService,
  ) {}

  async list(session: SessionResponse): Promise<SessionDevicesResponse> {
    const assets = await this.prisma.asset.findMany({
      where: { themeId: session.themeId, kind: 'device' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, data: true },
    });
    const codes = new Map(
      (session.testDeviceCodes ?? []).map((d) => [d.deviceId, d.code]),
    );
    const media = this.runtime.getSessionMedia(session.id);
    const websites = new Map(
      (media?.websites ?? []).map((w) => [w.deviceId, w]),
    );
    const states = new Map((media?.states ?? []).map((s) => [s.deviceId, s]));
    const devices: SessionDeviceStatus[] = assets.map((asset) => {
      const windows = this.registry.socketsFor(session.id, asset.id).length;
      const versions = this.registry.versionsFor(session.id, asset.id);
      const website = websites.get(asset.id) ?? null;
      const state = states.get(asset.id) ?? null;
      const data = asset.data as { displayName?: unknown } | null;
      const displayName =
        typeof data?.displayName === 'string' && data.displayName
          ? data.displayName
          : asset.name;
      const helperLoaded =
        versions.helperVersion !== undefined &&
        versions.helperVersion !== null;
      return {
        deviceId: asset.id,
        deviceName: asset.name,
        displayName,
        code: codes.get(asset.id) ?? null,
        online: windows > 0,
        windows,
        clientVersion: versions.clientVersion,
        helperVersion: versions.helperVersion,
        helperMessages: versions.helperMessages,
        helperTestCallbacks: versions.helperTestCallbacks,
        helperStates: versions.helperStates,
        website: website
          ? {
              websiteId: website.websiteId,
              url: website.url,
              startedAt: website.startedAt,
            }
          : null,
        state: state
          ? {
              stateId: state.stateId,
              stateName: state.stateName,
              startedAt: state.startedAt,
            }
          : null,
        screenshotAt: this.registry.screenshotAt(session.id, asset.id),
        ready: windows === 1 && (website === null || helperLoaded),
      };
    });
    return {
      sessionId: session.id,
      mode: session.mode,
      state: session.state,
      devices,
    };
  }
}
