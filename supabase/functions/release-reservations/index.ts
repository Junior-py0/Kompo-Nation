import {
  json,
  required,
  rpc,
} from "../_shared/runtime.ts";

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

      const released =
        await rpc(
          "release_expired_reservations",
          {},
        );

      return json(request, 200, {
        ok: true,
        released,
      });
    } catch (error) {
      console.error(
        "release-reservations failed:",
        error,
      );

      return json(request, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Reservation cleanup failed.",
      });
    }
  },
);
