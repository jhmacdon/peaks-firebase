"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { getFriends, type Friend } from "../lib/actions/profile";
import { getUsers, type UserInfo } from "../lib/actions/users";
import { inviteToPlan } from "../lib/actions/plans";
import Avatar from "./avatar";
import { Button } from "./ui/button";
import { Label, Select } from "./ui/field";

export default function TripParty({ planId, ownerId, partyIds, onChanged }: { planId: string; ownerId: string; partyIds: string[]; onChanged: () => Promise<void> }) {
  const { user, getIdToken } = useAuth();
  const isOwner = user?.uid === ownerId;
  const key = [ownerId, ...partyIds].join(",");
  const [members, setMembers] = useState<UserInfo[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendId, setFriendId] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to see the group.");
      const [people, available] = await Promise.all([getUsers(token, key.split(",")), isOwner ? getFriends(token) : Promise.resolve([])]);
      if (!people.some((person) => person.uid === ownerId)) throw new Error("The trip owner’s profile is unavailable.");
      setMembers(people); setFriends(available);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn’t load the group."); }
    finally { setLoading(false); }
  }, [getIdToken, key, isOwner, ownerId]);
  useEffect(() => { void load(); }, [load]);
  async function invite() {
    setInviting(true); setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to invite a friend.");
      await inviteToPlan(token, planId, friendId);
      setFriendId("");
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn’t invite your friend."); }
    finally { setInviting(false); }
  }
  const available = friends.filter((friend) => friend.friendUserId !== ownerId && !partyIds.includes(friend.friendUserId));
  return <section className="mt-10" aria-labelledby="trip-group-title">
    <h2 id="trip-group-title" className="text-xl font-medium text-ink">Who’s going</h2>
    {loading ? <p role="status" className="mt-4 text-sm text-muted">Loading the group…</p> : <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-4">{members.map((person) => <li key={person.uid} className="flex items-center gap-3"><Avatar name={person.displayName} avatarUrl={person.photoURL} size="sm" /><div><p className="font-medium text-ink">{person.displayName || "Peaks member"}</p><p className="text-xs text-muted">{person.uid === ownerId ? "Trip owner" : "Going"}{person.uid === user?.uid ? " · You" : ""}</p></div></li>)}</ul>}
    {error && <div role="alert" className="mt-4 text-sm text-alert"><p>{error}</p><Button type="button" variant="quiet" onClick={load}>Try again</Button></div>}
    {isOwner && !loading && <div className="mt-6 max-w-xl">
      {available.length > 0 ? <><Label htmlFor="trip-friend">Invite a friend</Label><div className="flex flex-wrap gap-3"><Select id="trip-friend" value={friendId} onChange={(event) => setFriendId(event.target.value)} className="min-w-0 flex-1"><option value="">Choose a friend</option>{available.map((friend) => <option key={friend.friendUserId} value={friend.friendUserId}>{friend.friendName}</option>)}</Select><Button type="button" variant="secondary" onClick={invite} disabled={!friendId || inviting}>{inviting ? "Inviting…" : "Invite"}</Button></div></> : <p className="text-sm text-muted">{friends.length === 0 ? "Add friends to plan your trip together." : "Your friends are already included."}</p>}
      <Button href="/account/friends" variant="quiet" className="mt-3">Manage friends</Button>
    </div>}
  </section>;
}
