import { RoomKitHelper } from './helper.js';

// iife entry: expose the class directly as window.RoomKitHelper so sites can
// `new RoomKitHelper()` after the <script> tag.
(globalThis as Record<string, unknown>).RoomKitHelper = RoomKitHelper;
