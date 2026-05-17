import { createFileRoute, Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { z } from "zod";

const CheckEmailSearch = z.object({
  email: z.string().email().optional(),
});

export const Route = createFileRoute("/_public/check-email")({
  validateSearch: CheckEmailSearch,
  component: CheckEmailPage,
});

function CheckEmailPage() {
  const { t } = useTranslation();
  const { email } = Route.useSearch();
  return (
    <section className="space-y-4 text-center py-8">
      <div className="text-5xl" aria-hidden="true">
        ✉️
      </div>
      <h1 className="text-2xl font-bold">{t("auth.checkEmail.title")}</h1>
      <p className="text-stone-600">
        {email ? (
          // Trans rendert die {{email}}-Adresse als <strong>; der i18n-Key
          // enthält den HTML-Marker "<strong>", den wir hier mit dem
          // components-Prop einer echten React-Komponente zuweisen.
          <Trans
            i18nKey="auth.checkEmail.introWithAddress"
            values={{ email }}
            components={{ strong: <strong /> }}
          />
        ) : (
          t("auth.checkEmail.intro")
        )}
      </p>
      <p className="text-sm text-stone-500">{t("auth.checkEmail.validity")}</p>
      <p className="text-sm">
        <Link to="/login" className="text-stone-900 underline">
          {t("auth.checkEmail.back")}
        </Link>
      </p>
    </section>
  );
}
