export type ServiceConfig = Readonly<{
  environment: string;
  databaseUrl: string;
}>;

export function loadServiceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServiceConfig {
  const name = environment.APP_ENVIRONMENT;
  const databaseUrl = environment.DATABASE_URL;
  if (!name || !databaseUrl) {
    throw new Error("APP_ENVIRONMENT and DATABASE_URL are required");
  }
  return { environment: name, databaseUrl };
}
