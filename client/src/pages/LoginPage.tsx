import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#111b31] p-6 shadow-xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-slate-100">Sec Agent Studio</h1>
          <p className="text-sm text-slate-400">Local access with RBAC and policy guardrails</p>
        </div>

        <div className="space-y-3">
          <input className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input className="input-dark" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
          {error ? <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-sm text-rose-200">{error}</div> : null}
          <button className="btn-primary w-full">Login</button>
        </div>

        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-400">
          admin@local / Admin123!<br />
          iam.maintainer@local / Maintainer123!<br />
          operator@local / Operator123!
        </div>
      </form>
    </div>
  );
}
