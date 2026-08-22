import {
  json,
  required,
  supabaseRequest,
} from "../_shared/runtime.ts";

function escapeHtml(
  value = "",
): string {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      } as Record<string, string>)[
        character
      ],
  );
}

function subject(
  key: string,
): string {
  return ({
    vendor_new_order:
      "A new Kompo Nation order is ready",

    customer_payment_confirmed:
      "Your Kompo Nation payment is confirmed",

    order_status:
      "Your Kompo Nation order has moved",
  } as Record<string, string>)[
    key
  ] || "Kompo Nation update";
}

Deno.serve(
  async (request: Request) => {
    if (request.method !== "POST") {
      return json(request, 405, {
        error:
          "Method not allowed.",
      });
    }

    try {
      const authorization =
        request.headers.get(
          "authorization",
        ) || "";

      if (
        authorization !==
        `Bearer ${
          required(
            "CRON_SECRET",
          )
        }`
      ) {
        return json(request, 401, {
          error: "Unauthorized.",
        });
      }

      const rows =
        await supabaseRequest(
          `notification_outbox?select=*&status=eq.pending&next_attempt_at=lte.${
            encodeURIComponent(
              new Date()
                .toISOString(),
            )
          }&order=created_at.asc&limit=25`,
        );

      let sent = 0;

      for (const row of rows) {
        try {
          const reference =
            escapeHtml(
              row.payload
                ?.reference ||
              "your order",
            );

          const response =
            await fetch(
              Deno.env.get(
                "EMAIL_API_BASE_URL",
              ) ||
              "https://api.resend.com/emails",
              {
                method: "POST",
                headers: {
                  Authorization:
                    `Bearer ${
                      required(
                        "EMAIL_API_KEY",
                      )
                    }`,
                  "Content-Type":
                    "application/json",
                },
                body:
                  JSON.stringify({
                    from:
                      required(
                        "EMAIL_FROM",
                      ),

                    to: [
                      row
                        .recipient_address,
                    ],

                    subject:
                      subject(
                        row.template_key,
                      ),

                    html:
                      `<div style="font-family:Arial,sans-serif;color:#252925;max-width:620px;margin:auto">` +
                      `<h1>Kompo Nation</h1>` +
                      `<p>Your update for <strong>${reference}</strong> is ready.</p>` +
                      `<p>Sign in to your Kompo Nation account for the current order status.</p>` +
                      `</div>`,
                  }),
              },
            );

          if (!response.ok) {
            throw new Error(
              "Email provider rejected the message.",
            );
          }

          await supabaseRequest(
            `notification_outbox?id=eq.${
              encodeURIComponent(
                row.id,
              )
            }`,
            {
              method: "PATCH",
              body: {
                status: "sent",

                sent_at:
                  new Date()
                    .toISOString(),

                attempts:
                  Number(
                    row.attempts,
                  ) + 1,
              },
            },
          );

          sent += 1;
        } catch (error) {
          console.error(
            "Notification failed:",
            row.id,
            error,
          );

          const attempts =
            Number(
              row.attempts,
            ) + 1;

          await supabaseRequest(
            `notification_outbox?id=eq.${
              encodeURIComponent(
                row.id,
              )
            }`,
            {
              method: "PATCH",
              body: {
                status:
                  Number(
                    row.attempts,
                  ) >= 4
                    ? "failed"
                    : "pending",

                attempts,

                next_attempt_at:
                  new Date(
                    Date.now() +
                    15 *
                      60 *
                      1000,
                  ).toISOString(),
              },
            },
          );
        }
      }

      return json(request, 200, {
        ok: true,
        sent,
      });
    } catch (error) {
      console.error(
        "process-notifications failed:",
        error,
      );

      return json(request, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Notification worker failed.",
      });
    }
  },
);
