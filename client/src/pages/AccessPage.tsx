import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AccessGroup, AccessUser, Role, Team } from "../lib/types";

const defaultUserForm = { email: "", password: "", role: "OPERATOR" as Role, teamId: "" };
const defaultGroupForm = { name: "", description: "", teamId: "" };

export function AccessPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [userForm, setUserForm] = useState(defaultUserForm);
  const [groupForm, setGroupForm] = useState(defaultGroupForm);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [resetTargetUserId, setResetTargetUserId] = useState("");
  const [newPassword, setNewPassword] = useState("Mudar123!");
  const [status, setStatus] = useState("");

  const load = async () => {
    const [teamsRes, usersRes, groupsRes] = await Promise.all([
      apiGet<{ teams: Team[] }>("/api/teams"),
      apiGet<{ users: AccessUser[] }>("/api/access/users"),
      apiGet<{ groups: AccessGroup[] }>("/api/access/groups"),
    ]);
    setTeams(teamsRes.teams);
    setUsers(usersRes.users);
    setGroups(groupsRes.groups);
    if (!selectedGroupId && groupsRes.groups[0]) setSelectedGroupId(groupsRes.groups[0].id);
    if (!resetTargetUserId && usersRes.users[0]) setResetTargetUserId(usersRes.users[0].id);
  };

  useEffect(() => {
    if (user?.role !== "ADMIN") return;
    void load();
  }, [user?.role]);

  const selectedGroup = useMemo(() => groups.find((g) => g.id === selectedGroupId) || null, [groups, selectedGroupId]);

  if (user?.role !== "ADMIN") {
    return <div className="panel p-4 text-sm text-amber-200">Access Management disponivel apenas para ADMIN.</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-100">Access Management</h2>

      {status ? <div className="panel p-3 text-xs text-emerald-300">{status}</div> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">Users</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input-dark" placeholder="email" value={userForm.email} onChange={(e) => setUserForm((s) => ({ ...s, email: e.target.value }))} />
            <input className="input-dark" placeholder="password" type="password" value={userForm.password} onChange={(e) => setUserForm((s) => ({ ...s, password: e.target.value }))} />
            <select className="input-dark" value={userForm.role} onChange={(e) => setUserForm((s) => ({ ...s, role: e.target.value as Role }))}>
              <option value="ADMIN">ADMIN</option>
              <option value="TEAM_MAINTAINER">TEAM_MAINTAINER</option>
              <option value="OPERATOR">OPERATOR</option>
            </select>
            <select className="input-dark" value={userForm.teamId} onChange={(e) => setUserForm((s) => ({ ...s, teamId: e.target.value }))}>
              <option value="">No team</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
            </select>
            <button
              className="btn-primary md:col-span-2"
              onClick={async () => {
                await apiPost("/api/access/users", {
                  email: userForm.email,
                  password: userForm.password,
                  role: userForm.role,
                  teamId: userForm.teamId || null,
                });
                setUserForm(defaultUserForm);
                setStatus("Usuario criado com sucesso.");
                await load();
              }}
            >
              Create User
            </button>
          </div>

          <div className="mt-4 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-2">Email</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Team</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-700/70 text-slate-300">
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.role}</td>
                    <td className="py-2">{u.team?.key || "-"}</td>
                    <td className="py-2">
                      <button
                        className="btn-ghost px-2 py-1"
                        onClick={async () => {
                          const nextRole: Role = u.role === "OPERATOR" ? "TEAM_MAINTAINER" : u.role === "TEAM_MAINTAINER" ? "ADMIN" : "OPERATOR";
                          await apiPut(`/api/access/users/${u.id}`, { role: nextRole, teamId: u.teamId });
                          setStatus(`Role de ${u.email} alterado para ${nextRole}.`);
                          await load();
                        }}
                      >
                        Rotate Role
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">Groups</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input-dark" placeholder="group name" value={groupForm.name} onChange={(e) => setGroupForm((s) => ({ ...s, name: e.target.value }))} />
            <select className="input-dark" value={groupForm.teamId} onChange={(e) => setGroupForm((s) => ({ ...s, teamId: e.target.value }))}>
              <option value="">Global group</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
            </select>
            <input className="input-dark md:col-span-2" placeholder="description" value={groupForm.description} onChange={(e) => setGroupForm((s) => ({ ...s, description: e.target.value }))} />
            <button
              className="btn-primary md:col-span-2"
              onClick={async () => {
                await apiPost("/api/access/groups", {
                  name: groupForm.name,
                  description: groupForm.description || null,
                  teamId: groupForm.teamId || null,
                });
                setGroupForm(defaultGroupForm);
                setStatus("Grupo criado com sucesso.");
                await load();
              }}
            >
              Create Group
            </button>
          </div>

          <div className="mt-4 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-2">Group</th>
                  <th className="py-2">Team</th>
                  <th className="py-2">Members</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-t border-slate-700/70 text-slate-300">
                    <td className="py-2">{g.name}</td>
                    <td className="py-2">{g.team?.key || "GLOBAL"}</td>
                    <td className="py-2">{g._count?.memberships ?? g.memberships.length}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button className="btn-ghost px-2 py-1" onClick={() => setSelectedGroupId(g.id)}>Select</button>
                        <button
                          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200"
                          onClick={async () => {
                            await apiDelete(`/api/access/groups/${g.id}`);
                            setStatus("Grupo removido.");
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">Group Memberships</h3>
          <div className="grid gap-2 md:grid-cols-3">
            <select className="input-dark" value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
              <option value="">Select group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select className="input-dark" value={selectedMemberId} onChange={(e) => setSelectedMemberId(e.target.value)}>
              <option value="">Select user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            <button
              className="btn-primary"
              disabled={!selectedGroupId || !selectedMemberId}
              onClick={async () => {
                await apiPost(`/api/access/groups/${selectedGroupId}/members`, { userId: selectedMemberId });
                setStatus("Membro adicionado ao grupo.");
                await load();
              }}
            >
              Add Member
            </button>
          </div>

          <div className="mt-3 space-y-1 text-xs">
            {(selectedGroup?.memberships || []).map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/30 px-2 py-1 text-slate-300">
                <span>{m.user.email} ({m.user.role})</span>
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={async () => {
                    if (!selectedGroupId) return;
                    await apiDelete(`/api/access/groups/${selectedGroupId}/members/${m.userId}`);
                    setStatus("Membro removido do grupo.");
                    await load();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            {!selectedGroup?.memberships?.length ? <div className="text-slate-400">Sem membros neste grupo.</div> : null}
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">Password Reset</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <select className="input-dark" value={resetTargetUserId} onChange={(e) => setResetTargetUserId(e.target.value)}>
              <option value="">Select user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            <input className="input-dark" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button
              className="btn-primary md:col-span-2"
              disabled={!resetTargetUserId || newPassword.length < 8}
              onClick={async () => {
                await apiPost(`/api/access/users/${resetTargetUserId}/reset-password`, { newPassword });
                setStatus("Senha resetada com sucesso.");
              }}
            >
              Reset Password
            </button>
          </div>
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/30 p-2 text-xs text-slate-400">
            Policies baseline: apenas ADMIN pode gerenciar usuarios e grupos nesta versao.
          </div>
        </div>
      </div>
    </div>
  );
}
