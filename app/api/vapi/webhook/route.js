import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const esc = (v = "") =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function assistantIdOf(message) {
  return message?.assistant?.id || message?.call?.assistantId || message?.call?.assistant?.id || null;
}

function callerOf(message) {
  return message?.customer?.number || message?.call?.customer?.number || "Unknown caller";
}

function summaryOf(message) {
  return message?.analysis?.summary || message?.call?.analysis?.summary || message?.summary || "No automatic summary was provided.";
}

function durationOf(message) {
  const start = message?.startedAt || message?.call?.startedAt;
  const end = message?.endedAt || message?.call?.endedAt;
  if (!start || !end) return "Not available";
  const seconds = Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function sendReport({ to, businessName, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or EMAIL_FROM");

  const caller = callerOf(message);
  const duration = durationOf(message);
  const summary = summaryOf(message);
  const transcript = message?.transcript || message?.artifact?.transcript || "";
  const callId = message?.call?.id || "Not available";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#111">
      <h2>AliwCall Call Report</h2>
      <p><strong>Business:</strong> ${esc(businessName)}</p>
      <p><strong>Caller:</strong> ${esc(caller)}</p>
      <p><strong>Duration:</strong> ${esc(duration)}</p>
      <p><strong>Call ID:</strong> ${esc(callId)}</p>
      <h3>Summary</h3>
      <p>${esc(summary)}</p>
      ${transcript ? `<h3>Transcript</h3><div style="white-space:pre-wrap;background:#f6f6f6;padding:14px;border-radius:8px">${esc(transcript)}</div>` : ""}
      <p style="margin-top:24px;color:#777;font-size:12px">Generated automatically by AliwCall.</p>
    </div>
  `;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `AliwCall Call Report - ${businessName}`,
      html,
    }),
  });

  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
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

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("name,email_reports_enabled")
      .eq("id", agent.business_id)
      .single();

    if (businessError) throw businessError;
    if (business.email_reports_enabled === false) {
      return NextResponse.json({ ok: true, ignored: "email-reports-disabled" });
    }

    const { data: member, error: memberError } = await supabase
      .from("business_members")
      .select("user_id")
      .eq("business_id", agent.business_id)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member?.user_id) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const { data, error: userError } = await supabase.auth.admin.getUserById(member.user_id);
    if (userError) throw userError;

    const email = data?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Registered email not found" }, { status: 404 });
    }

    await sendReport({
      to: email,
      businessName: business?.name || "Your business",
      message,
    });

    return NextResponse.json({ ok: true, emailed: email });
  } catch (error) {
    console.error("Vapi webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
