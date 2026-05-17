/**
 * „Bitte E-Mail bestätigen"-Seite nach Registrierung. Erinnert den User,
 * dass er den Link in der Verify-Mail klicken soll. Eigentliche Verify-
 * Logik macht der Server (Better Auth) beim Klick auf den Link.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

const CheckEmailSearch = z.object({
  email: z.string().email().optional(),
});

export const Route = createFileRoute("/_public/check-email")({
  validateSearch: CheckEmailSearch,
  component: CheckEmailPage,
});

function CheckEmailPage() {
  const { email } = Route.useSearch();
  return (
    <section className="space-y-4 text-center py-8">
      <div className="text-5xl" aria-hidden="true">
        ✉️
      </div>
      <h1 className="text-2xl font-bold">Bitte E-Mail bestätigen</h1>
      <p className="text-stone-600">
        Wir haben dir
        {email ? (
          <>
            {" "}
            einen Link an <strong>{email}</strong>
          </>
        ) : (
          " einen Link"
        )}{" "}
        geschickt. Klick drauf, und dann kannst du mitspielen.
      </p>
      <p className="text-sm text-stone-500">
        Der Link ist 24 Stunden gültig. Schau auch im Spam-Ordner nach.
      </p>
      <p className="text-sm">
        <Link to="/login" className="text-stone-900 underline">
          Zurück zur Anmeldung
        </Link>
      </p>
    </section>
  );
}
