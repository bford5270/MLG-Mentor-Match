export interface Config {
  sessionSecret: string;
  production: boolean;
  /** Emails that become admins on sign-in, even if not on the roster. */
  adminEmails: string[];
  emailFrom: string;
  resendApiKey?: string;
  /** Public URL of the app, used in emails. */
  siteUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const sessionSecret = env.SESSION_SECRET ?? (production ? "" : "dev-only-secret");
  if (!sessionSecret) throw new Error("SESSION_SECRET is not set");
  return {
    sessionSecret,
    production,
    adminEmails: (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    emailFrom: env.EMAIL_FROM ?? "1st MLG Mentorship <mentorship@1stmedlisteningpost.com>",
    resendApiKey: env.RESEND_API_KEY || undefined,
    siteUrl: env.SITE_URL ?? "https://app-production-37c9.up.railway.app",
  };
}
