export interface Env {
  DB: D1Database;
  /** Comma-separated list of allowed CORS origins. */
  ALLOWED_ORIGINS: string;
  /** base64url of the uncompressed P-256 VAPID public key (65 bytes). */
  VAPID_PUBLIC_KEY: string;
  /** mailto: or https: contact for push services. */
  VAPID_SUBJECT: string;
  /** Secret: JSON string of the EC P-256 private JWK. */
  VAPID_PRIVATE_JWK?: string;
  /** Max pushes per cron run (string var). */
  PUSH_BATCH?: string;
}
