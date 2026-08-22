const { json, required, rpc } = require("./lib/runtime");

exports.handler = async (event) => {
  try {
    const authorization = event.headers.authorization || "";
    if (authorization !== `Bearer ${required("CRON_SECRET")}` && event.headers["x-netlify-event"] !== "schedule" && !event.next_run) return json(401, { error: "Unauthorized." });
    const released = await rpc("release_expired_reservations", {});
    return json(200, { ok: true, released });
  } catch (error) { return json(500, { error: error.message }); }
};
