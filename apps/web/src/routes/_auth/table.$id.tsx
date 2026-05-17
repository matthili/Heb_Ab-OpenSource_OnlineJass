/**
 * Route für einen einzelnen Tisch: `/table/<id>`.
 * Auth-Guard ist durch `_auth.tsx` schon abgehakt.
 */
import { createFileRoute } from "@tanstack/react-router";

import { TableDetail } from "~/features/lobby/TableDetail";

export const Route = createFileRoute("/_auth/table/$id")({
  component: TablePage,
});

function TablePage() {
  const { id } = Route.useParams();
  return <TableDetail tableId={id} />;
}
