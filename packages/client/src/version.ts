/**
 * Reported to the server in the /device auth handshake so studio can warn
 * about outdated clients. Kept as a source literal (not a build-time define)
 * because the player compiles this package from source via a vite alias.
 * Keep in sync with package.json.
 */
export const CLIENT_VERSION = '0.1.0';
