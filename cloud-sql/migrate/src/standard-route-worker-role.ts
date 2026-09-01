import type { JobStage, JobState } from "./standard-route-job-state";

export const ROUTE_FACTORY_DATABASE_ROLE = "peaks-route-factory";
export const ROUTE_REVIEWER_DATABASE_ROLE = "peaks-route-reviewer";

type RoleRow = {
  database_user: string;
  is_factory: boolean;
  is_reviewer: boolean;
};

export type RouteWorkerRoleQueryable = {
  query: (text: string) => Promise<{ rows: unknown[] }>;
};

export function databaseRoleForClaim(stage: JobStage): string {
  return stage === "review"
    ? ROUTE_REVIEWER_DATABASE_ROLE
    : ROUTE_FACTORY_DATABASE_ROLE;
}

export function databaseRoleForTransition(from: JobState): string {
  return from === "pending_review"
    ? ROUTE_REVIEWER_DATABASE_ROLE
    : ROUTE_FACTORY_DATABASE_ROLE;
}

export async function requireRouteWorkerDatabaseRole(
  connection: RouteWorkerRoleQueryable,
  requiredRole: string
): Promise<void> {
  if (
    requiredRole !== ROUTE_FACTORY_DATABASE_ROLE &&
    requiredRole !== ROUTE_REVIEWER_DATABASE_ROLE
  ) {
    throw new Error(`unsupported route worker database role: ${requiredRole}`);
  }
  const result = await connection.query(
    `SELECT session_user::text AS database_user,
            pg_has_role(session_user, 'peaks-route-factory', 'member')
              AS is_factory,
            pg_has_role(session_user, 'peaks-route-reviewer', 'member')
              AS is_reviewer`
  );
  const role = result.rows[0] as RoleRow | undefined;
  if (!role || role.is_factory === role.is_reviewer) {
    throw new Error(
      "route worker database login must belong to exactly one worker role"
    );
  }
  const allowed =
    requiredRole === ROUTE_FACTORY_DATABASE_ROLE
      ? role.is_factory
      : role.is_reviewer;
  if (!allowed) {
    throw new Error(
      `database login ${role.database_user} cannot act as ${requiredRole}`
    );
  }
}
