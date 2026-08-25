import {
  json,
  rawBody,
  required,
  supabaseRequest,
} from "../_shared/runtime.ts";

function mappedStatus(
  value: unknown,
): string | null {
  const status =
    String(value || "")
      .toLowerCase();

  if (
    [
      "collected",
      "in_transit",
      "out_for_delivery",
      "shipped",
    ].some(
      (part) =>
        status.includes(part),
    )
  ) {
    return "shipped";
  }

  if (
    [
      "delivered",
      "completed",
    ].some(
      (part) =>
        status.includes(part),
    )
  ) {
    return "delivered";
  }

  if (
    [
      "cancelled",
      "failed",
    ].some(
      (part) =>
        status.includes(part),
    )
  ) {
    return "cancelled";
  }

  return null;
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
      const url =
        new URL(request.url);

      const token =
        request.headers.get(
          "x-kompo-webhook-token",
        ) ||
        url.searchParams.get(
          "token",
        );

      if (
        !token ||
        token !==
          required(
            "BOBGO_WEBHOOK_SECRET",
          )
      ) {
        return json(request, 401, {
          error:
            "Invalid webhook token.",
        });
      }

      const text =
        await rawBody(request);

      const payload =
        JSON.parse(text || "{}");

      const providerId =
        String(
          payload.shipment_id ||
          payload.id ||
          payload.shipment?.id ||
          "",
        );

      const eventKey =
        String(
          payload.event_id ||
          payload.id ||
          `${
            providerId
          }:${
            payload.status ||
            payload.tracking_status ||
            "update"
          }`,
        );

      if (!providerId) {
        return json(request, 400, {
          error:
            "Shipment identity is missing.",
        });
      }

      try {
        await supabaseRequest(
          "webhook_events",
          {
            method: "POST",
            body: {
              provider: "bobgo",
              event_key:
                eventKey,
              payload,
            },
            headers: {
              Prefer:
                "resolution=ignore-duplicates",
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        if (
          message
            .toLowerCase()
            .includes("duplicate")
        ) {
          return json(request, 200, {
            ok: true,
            duplicate: true,
          });
        }

        throw error;
      }

      const shipments =
        await supabaseRequest(
          `shipments?select=id,vendor_order_id,status&provider_shipment_id=eq.${
            encodeURIComponent(
              providerId,
            )
          }&limit=1`,
        );

      if(!shipments.length){
      // RETURN_TRACKING_V1
      const rr=await supabaseRequest(`return_shipments?select=id,return_id,leg,status&provider_shipment_id=eq.${encodeURIComponent(providerId)}&limit=1`);
      if(!rr.length)return json(request,202,{ok:true,unmatched:true});
      const s=rr[0],mapped=mappedStatus(payload.status||payload.tracking_status||payload.event),rs=mapped==="shipped"?"in_transit":mapped,changes:any={provider_payload:payload,updated_at:new Date().toISOString()};
      if(["in_transit","delivered","cancelled"].includes(rs))changes.status=rs;
      if(payload.tracking_reference||payload.tracking_number)changes.tracking_reference=payload.tracking_reference||payload.tracking_number;
      if(payload.tracking_url)changes.tracking_url=payload.tracking_url;
      await supabaseRequest(`return_shipments?id=eq.${encodeURIComponent(s.id)}`,{method:"PATCH",body:changes});
      if(s.leg==="reverse"&&rs==="in_transit")await supabaseRequest(`returns?id=eq.${encodeURIComponent(s.return_id)}`,{method:"PATCH",body:{status:"in_transit",updated_at:new Date().toISOString()}});
      if(s.leg==="exchange_outbound"&&rs==="delivered")await supabaseRequest(`returns?id=eq.${encodeURIComponent(s.return_id)}`,{method:"PATCH",body:{status:"closed",completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
      return json(request,200,{ok:true,returnShipment:true});
    }

      const shipment =
        shipments[0];

      const status =
        mappedStatus(
          payload.status ||
          payload.tracking_status ||
          payload.event,
        );

      const changes:
        Record<string, unknown> = {
          provider_payload:
            payload,
          updated_at:
            new Date()
              .toISOString(),
        };

      if (status) {
        changes.status = status;
      }

      if (
        payload.tracking_reference ||
        payload.tracking_number
      ) {
        changes
          .tracking_reference =
          payload.tracking_reference ||
          payload.tracking_number;
      }

      if (
        payload.tracking_url
      ) {
        changes.tracking_url =
          payload.tracking_url;
      }

      await supabaseRequest(
        `shipments?id=eq.${
          encodeURIComponent(
            shipment.id,
          )
        }`,
        {
          method: "PATCH",
          body: changes,
        },
      );

      if (status) {
        await supabaseRequest(
          `vendor_orders?id=eq.${
            encodeURIComponent(
              shipment
                .vendor_order_id,
            )
          }`,
          {
            method: "PATCH",
            body: {
              fulfilment_status:
                status,
              updated_at:
                new Date()
                  .toISOString(),
            },
          },
        );
      }

      return json(request, 200, {
        ok: true,
      });
    } catch (error) {
      console.error(
        "bobgo-webhook failed:",
        error,
      );

      return json(request, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Webhook failed.",
      });
    }
  },
);
