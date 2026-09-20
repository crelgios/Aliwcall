"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

const tabs = ["Home", "Calls", "Leads", "Agent", "Business"];

export default function Page() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  if (loading) return <main className="center">Loading AliwCall…</main>;
  if (!session) return <Auth supabase={supabase} />;

  return <Dashboard supabase={supabase} userId={session.user.id} />;
}

function Auth({ supabase }) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    const result =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    setBusy(false);

    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to confirm your account.");
    }
  }

  return (
    <main className="center authWrap">
      <section className="authCard">
        <div className="brand">AliwCall</div>
        <h1>AI receptionist for small businesses</h1>
        <p>Answer calls, capture leads and manage your business from one place.</p>

        <form onSubmit={submit}>
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            placeholder="Password"
            type="password"
            minLength="6"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        {message && <div className="notice">{message}</div>}

        <button
          className="linkBtn"
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "New to AliwCall? Create account"}
        </button>
      </section>
    </main>
  );
}

function Dashboard({ supabase, userId }) {
  const [tab, setTab] = useState("Home");
  const [business, setBusiness] = useState(null);
  const [agent, setAgent] = useState(null);
  const [calls, setCalls] = useState([]);
  const [leads, setLeads] = useState([]);
  const [usage, setUsage] = useState({ used_minutes: 0, included_minutes: 20 });
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);

    const membership = await supabase
      .from("business_members")
      .select("business_id, businesses(*)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    const currentBusiness = membership.data?.businesses || null;
    setBusiness(currentBusiness);

    if (currentBusiness) {
      const [agentResult, callsResult, leadsResult, usageResult] =
        await Promise.all([
          supabase
            .from("agents")
            .select("*")
            .eq("business_id", currentBusiness.id)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("calls")
            .select("*")
            .eq("business_id", currentBusiness.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("leads")
            .select("*")
            .eq("business_id", currentBusiness.id)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("usage_monthly")
            .select("*")
            .eq("business_id", currentBusiness.id)
            .order("month", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      setAgent(agentResult.data || null);
      setCalls(callsResult.data || []);
      setLeads(leadsResult.data || []);

      if (usageResult.data) setUsage(usageResult.data);
    }

    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) return <main className="center">Loading dashboard…</main>;
  if (!business) return <BusinessSetup supabase={supabase} onDone={refresh} />;

  return (
    <main className="appShell">
      <header>
        <div>
          <div className="brand">AliwCall</div>
          <small>{business.name}</small>
        </div>

        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <section className="content">
        {tab === "Home" && (
          <Home agent={agent} calls={calls} leads={leads} usage={usage} />
        )}
        {tab === "Calls" && (
          <Calls
            calls={calls}
            onRefresh={async () => {
              if (!business?.id) return;
              const { data } = await supabase
                .from("calls")
                .select("*")
                .eq("business_id", business.id)
                .order("created_at", { ascending: false })
                .limit(50);
              setCalls(data || []);
            }}
          />
        )}
        {tab === "Leads" && <Leads leads={leads} />}
        {tab === "Agent" && (
          <Agent
            supabase={supabase}
            business={business}
            agent={agent}
            onDone={refresh}
          />
        )}
        {tab === "Business" && (
          <Business
            supabase={supabase}
            business={business}
            onDone={refresh}
          />
        )}
      </section>

      <nav>
        {tabs.map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </main>
  );
}

function BusinessSetup({ supabase, onDone }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const { error: rpcError } = await supabase.rpc(
      "create_business_for_current_user",
      {
        p_name: name,
        p_category: category || null,
        p_phone: phone || null,
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    await onDone();
  }

  return (
    <main className="center authWrap">
      <section className="authCard">
        <div className="brand">AliwCall</div>
        <h1>Set up your business</h1>

        <form onSubmit={create}>
          <input
            placeholder="Business name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <input
            placeholder="Category (Salon, Clinic, Shop…)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />

          <input
            placeholder="Business phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <button disabled={busy}>
            {busy ? "Creating…" : "Create business"}
          </button>
        </form>

        {error && <div className="notice">{error}</div>}
      </section>
    </main>
  );
}

function Home({ agent, calls, leads, usage }) {
  const left = Math.max(
    Number(usage.included_minutes) - Number(usage.used_minutes),
    0
  );

  const usagePercent = usage.included_minutes
    ? Math.min(
        (Number(usage.used_minutes) / Number(usage.included_minutes)) * 100,
        100
      )
    : 0;

  return (
    <>
      <h1>Dashboard</h1>

      <div className="hero">
        <span>AI Receptionist</span>
        <strong>{agent?.enabled ? "● ON" : "○ OFF"}</strong>
      </div>

      <div className="grid">
        <Card n={calls.length} label="Calls" />
        <Card n={leads.length} label="Leads" />
        <Card n={usage.used_minutes} label="Minutes used" />
        <Card n={left} label="Free minutes left" />
      </div>

      <div className="panel">
        <h3>Free plan</h3>
        <p>
          {usage.used_minutes} of {usage.included_minutes} AI minutes used this month.
        </p>
        <div className="track">
          <div className="fill" style={{ width: `${usagePercent}%` }} />
        </div>
      </div>
    </>
  );
}

function Card({ n, label }) {
  return (
    <div className="metric">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Calls({ calls, onRefresh }) {
  const [openId, setOpenId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  function callerReplyPreview(call) {
    const transcript = String(call.transcript || "").trim();
    if (!transcript) return call.summary || "No caller reply captured.";

    const lines = transcript
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const callerLines = lines.filter((line) =>
      /^(user|customer|caller)\s*:/i.test(line)
    );

    const raw = callerLines.length
      ? callerLines[callerLines.length - 1]
      : lines[lines.length - 1];

    return raw.replace(/^(user|customer|caller)\s*:\s*/i, "");
  }

  async function refreshCalls() {
    if (!onRefresh) return;
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <>
      <div className="callsHeader">
        <div>
          <h1>Calls</h1>
          <p className="muted">{calls.length} recent calls</p>
        </div>
        <button
          type="button"
          className="refreshBtn"
          onClick={refreshCalls}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {calls.length ? (
        <div className="callsTableWrap">
          <div className="callsTableHeader">
            <span>Time</span>
            <span>Caller</span>
            <span>Duration</span>
            <span>Caller reply</span>
            <span>Status</span>
          </div>

          {calls.map((call) => {
            const seconds = Number(call.duration_seconds || 0);
            const minutes = Math.floor(seconds / 60);
            const remainder = seconds % 60;
            const when = call.started_at || call.created_at;
            const isOpen = openId === call.id;
            const reply = callerReplyPreview(call);

            return (
              <div className="callRowGroup" key={call.id}>
                <button
                  type="button"
                  className={"callRow" + (isOpen ? " selected" : "")}
                  onClick={() => setOpenId(isOpen ? null : call.id)}
                >
                  <span data-label="Time">
                    {when
                      ? new Date(when).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                  <span data-label="Caller" className="callerCell">
                    {call.caller_number || call.callee_number || "Unknown caller"}
                  </span>
                  <span data-label="Duration">
                    {minutes}m {remainder}s
                  </span>
                  <span data-label="Caller reply" className="replyCell" title={reply}>
                    {reply}
                  </span>
                  <span data-label="Status">
                    {call.status || "ended"}
                  </span>
                </button>

                {isOpen && (
                  <div className="callDetail">
                    <div className="detailTop">
                      <div>
                        <strong>
                          {call.caller_number || call.callee_number || "Unknown caller"}
                        </strong>
                        <small>
                          {when ? new Date(when).toLocaleString() : "Time unavailable"}
                        </small>
                      </div>
                      <span>
                        {(call.direction || "inbound").toUpperCase()} · {minutes}m {remainder}s
                      </span>
                    </div>

                    <div className="detailGrid">
                      <div>
                        <small>Status</small>
                        <p>{call.status || "ended"}</p>
                      </div>
                      <div>
                        <small>Call ID</small>
                        <p>{call.provider_call_id || "Not available"}</p>
                      </div>
                    </div>

                    {call.summary &&
                      call.summary !== "No automatic summary was provided." && (
                        <>
                          <h4>Summary</h4>
                          <p>{call.summary}</p>
                        </>
                      )}

                    <h4>Conversation</h4>
                    <div className="transcript">
                      {call.transcript || "No transcript was captured for this call."}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">No calls yet.</div>
      )}
    </>
  );
}

function Leads({ leads }) {
  return (
    <>
      <h1>Leads</h1>
      {leads.length ? (
        leads.map((lead) => (
          <div className="panel" key={lead.id}>
            <h3>{lead.name || "New lead"}</h3>
            <p>{lead.phone || "No phone saved"}</p>
            <small>{lead.requirement || lead.status}</small>
          </div>
        ))
      ) : (
        <div className="panel">No leads yet.</div>
      )}
    </>
  );
}

function Agent({ supabase, business, agent, onDone }) {
  const [name, setName] = useState(agent?.name || `${business.name} Receptionist`);
  const [greeting, setGreeting] = useState(
    agent?.greeting ||
      `Hello, thank you for calling ${business.name}. How can I help you today?`
  );
  const [prompt, setPrompt] = useState(
    agent?.system_prompt ||
      `You are the helpful AI receptionist for ${business.name}. Be concise and polite. Never invent prices or policies. Collect the caller's name, phone number and requirement when appropriate. Escalate uncertain questions to a human.`
  );
  const [language, setLanguage] = useState(agent?.language || "en-IN");
  const [enabled, setEnabled] = useState(agent?.enabled || false);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);

    const payload = {
      business_id: business.id,
      name,
      greeting,
      system_prompt: prompt,
      language,
      voice: agent?.voice || "default",
      enabled,
      provider: agent?.provider || "vapi",
    };

    const result = agent
      ? await supabase.from("agents").update(payload).eq("id", agent.id)
      : await supabase.from("agents").insert(payload);

    setBusy(false);

    if (!result.error) onDone();
    else alert(result.error.message);
  }

  return (
    <>
      <h1>AI Agent</h1>
      <form className="formPanel" onSubmit={save}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows="3" />
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows="8" />
        <input value={language} onChange={(e) => setLanguage(e.target.value)} />

        <label className="switchRow">
          <span>Agent enabled</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>

        <button disabled={busy}>{busy ? "Saving…" : "Save agent"}</button>
      </form>
    </>
  );
}

function Business({ supabase, business, onDone }) {
  const [form, setForm] = useState({
    name: business.name || "",
    category: business.category || "",
    phone: business.phone || "",
    transfer_number: business.transfer_number || "",
    address: business.address || "",
    working_hours: business.working_hours || "",
  });

  const set = (key, value) => setForm({ ...form, [key]: value });

  async function save(e) {
    e.preventDefault();

    const { error } = await supabase
      .from("businesses")
      .update(form)
      .eq("id", business.id);

    if (error) alert(error.message);
    else onDone();
  }

  return (
    <>
      <h1>Business</h1>

      <form className="formPanel" onSubmit={save}>
        <input
          placeholder="Business name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <input
          placeholder="Category"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
        />
        <input
          placeholder="Public phone"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
        <input
          placeholder="Human transfer number"
          value={form.transfer_number}
          onChange={(e) => set("transfer_number", e.target.value)}
        />
        <input
          placeholder="Address / service area"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
        />
        <textarea
          placeholder="Working hours"
          rows="4"
          value={form.working_hours}
          onChange={(e) => set("working_hours", e.target.value)}
        />
        <button>Save business</button>
      </form>
    </>
  );
}
