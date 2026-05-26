/**
 * @jass/shared-types — Zod-Schemas als Single Source of Truth zwischen
 * `apps/api` und `apps/web`.
 *
 * **Pattern**: jede REST-Endpoint-Form lebt hier als Zod-Schema. Das Backend
 * importiert sie als Runtime-Validator (`ZodValidationPipe`), das Frontend
 * leitet seine Typen per `z.infer` ab. Bei Form-Änderungen kompiliert es
 * beidseitig nicht mehr — keine stille Drift.
 *
 * **Aktueller Migrations-Stand** (siehe PLAN.md §14):
 *   - ✅ Lobby (OpenTableDto, UpdateTableSettings, InviteUser, RematchVote,
 *     ListTablesQuery, View-Shapes)
 *   - ⬜ Chat, Auth, Admin, Replay, Users — folgen schrittweise
 *
 * OpenAPI-JSON wird per `pnpm --filter @jass/shared-types gen:openapi` aus
 * diesen Schemas generiert (`scripts/generate-openapi.ts`).
 */
export * from "./contracts/lobby.js";
