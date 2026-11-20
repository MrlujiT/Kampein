export type Seat = 'mca' | 'mp' | 'senator' | 'woman_rep' | 'governor';
export type Role = 'owner' | 'manager' | 'finance' | 'coordinator' | 'agent' | 'clerk';
export type ActivityKind = 'door_to_door' | 'meeting' | 'rally' | 'recruitment' | 'other';

export interface Campaign {
  id: string;
  name: string;
  candidate_name: string;
  seat: Seat;
  county: string | null;
  constituency: string | null;
  ward: string | null;
  election_date: string | null;
}

export interface Member {
  id: string;
  campaign_id: string;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  ward_id: string | null;
  polling_station_id: string | null;
  active: boolean;
}

export interface Ward {
  id: string;
  name: string;
  constituency: string | null;
  county: string | null;
  registered_voters: number;
  target_share: number;
}

export interface PollingStation {
  id: string;
  ward_id: string;
  code: string | null;
  name: string;
  registered_voters: number;
}

export interface WardProgress {
  ward_id: string;
  name: string;
  constituency: string | null;
  registered_voters: number;
  target_votes: number;
  people_reached: number;
  activity_count: number;
  activities_7d: number;
}

export const SEAT_LABELS: Record<Seat, string> = {
  mca: 'MCA',
  mp: 'MP',
  senator: 'Senator',
  woman_rep: 'Woman Rep',
  governor: 'Governor',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Candidate',
  manager: 'Campaign manager',
  finance: 'Finance lead',
  coordinator: 'Ward coordinator',
  agent: 'Agent',
  clerk: 'Data clerk',
};

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  door_to_door: 'Door to door',
  meeting: 'Meeting',
  rally: 'Rally',
  recruitment: 'Recruitment',
  other: 'Other',
};

/** Roles that can see the whole campaign rather than one ward. */
export const LEADERSHIP: Role[] = ['owner', 'manager', 'finance'];
export const CAN_MANAGE_STRUCTURE: Role[] = ['owner', 'manager'];
