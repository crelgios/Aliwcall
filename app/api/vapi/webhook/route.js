import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

function assistantIdOf(message) {
  return (
    message?.assistant?.id ||
    message?.call?.assistantId ||
    message?.call?.assistant?.id ||
    null
  );
}

function callerOf(message) {
  return (
    message?.customer?.number ||
    message?.call?.customer?.number ||
    "Unknown caller"
  );
}

function calleeOf(message) {
  return (
    message?.phoneNumber?.number ||
    message?.call?.phoneNumber?.number ||
    message?.call?.phoneNumber ||
    null
  );
}

function summaryOf(message) {
  return (
    message?.analysis?.summary ||
    message?.call?.analysis?.summary ||
    message?.summary ||
    "No automatic summary was provided."
  );
}

function transcriptOf(message) {
  return message?.transcript || message?.artifact?.transcript || "";
}

function startedAtOf(message) {
  return message?.startedAt || message?.call?.startedAt || null;
}

function endedAtOf(message) {
  return message?.endedAt || message?.call?.endedAt || null;
}

function durationSecondsOf(message) {
  const start = startedAtOf(message);
  const end = endedAtOf(message);
  if (start && end) {
    return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
  }

  const duration =
    message?.durationSeconds ||
    message?.call?.durationSeconds ||
    message?.artifact?.durationSeconds;

  return Number.isFinite(Number(duration)) ? Math.max(0, Math.round(Number(duration))) : 0;
}

function directionOf(message) {
  const type = String(message?.call?.type || "").toLowerCase();
  if (type.includes("outbound")) return "outbound";
  if (type.includes("inbound")) return "inbound";
  return "inbound";
}

export async function POST(request) {
  try {
    const token = process.env.VAPI_WEBHOOK_TOKEN;

    if (token) {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${token}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();
    const message = body?.message;

    if (!message?.type) {
      return NextResponse.json({ ok: true, ignored: "no-message-type" });
    }

    if (message.type !== "end-of-call-report") {
      return NextResponse.json({ ok: true, ignored: message.type });
    }

    const assistantId = assistantIdOf(message);
    if (!assistantId) {
      return NextResponse.json({ error: "Assistant ID missing" }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("business_id")
      .eq("provider", "vapi")
      .eq("provider_assistant_id", assistantId)
      .maybeSingle();

    if (agentError) throw agentError;

    if (!agent?.business_id) {
      return NextResponse.json({ ok: true, ignored: "assistant-not-linked" });
    }

    const providerCallId = message?.call?.id || null;

    const report = {
      business_id: agent.business_id,
      provider_call_id: providerCallId,
      direction: directionOf(message),
      caller_number: callerOf(message),
      callee_number: calleeOf(message),
      duration_seconds: durationSecondsOf(message),
      summary: summaryOf(message),
      transcript: transcriptOf(message),
      status: message?.endedReason || message?.call?.status || "ended",
      started_at: startedAtOf(message),
      ended_at: endedAtOf(message),
      raw_report: message,
    };

    let result;

    if (providerCallId) {
      result = await supabase
        .from("calls")
        .upsert(report, { onConflict: "provider_call_id" })
        .select("id")
        .single();
    } else {
      result = await supabase
        .from("calls")
        .insert(report)
        .select("id")
        .single();
    }

    if (result.error) throw result.error;

    return NextResponse.json({
      ok: true,
      saved: true,
      call_id: result.data?.id || providerCallId,
    });
  } catch (error) {
    console.error("Vapi webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
